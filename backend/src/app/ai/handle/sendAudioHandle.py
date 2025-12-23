from __future__ import annotations
import json
import time
import asyncio
import struct
from typing import TYPE_CHECKING
from app.ai.utils import textUtils
from app.ai.utils.util import audio_to_data
from app.ai.providers.tts.dto.dto import SentenceType
from app.ai.utils.audioRateController import AudioRateController

if TYPE_CHECKING:
    from app.ai.connection import (
        ConnectionHandler,
    )  # chỉ dùng cho hint, không chạy lúc runtime

TAG = __name__

AUDIO_FRAME_DURATION = 60
PRE_BUFFER_COUNT = 5


async def sendAudioMessage(
    conn: ConnectionHandler, sentenceType: SentenceType, audios: bytes, text: str
):
    if conn.tts.tts_audio_first_sentence:
        conn.logger.bind(tag=TAG).debug(f"Gửi đoạn âm thanh đầu tiên: {text}")
        conn.tts.tts_audio_first_sentence = False
        await send_tts_message(conn, "start", None)

    if sentenceType == SentenceType.FIRST:
        # Nếu đã có audio_rate_controller và cùng sentence_id, đưa tin nhắn vào queue
        if (
            hasattr(conn, "audio_rate_controller")
            and conn.audio_rate_controller
            and getattr(conn, "audio_flow_control", {}).get("sentence_id")
            == conn.sentence_id
        ):
            conn.audio_rate_controller.add_message(
                lambda: send_tts_message(conn, "sentence_start", text)
            )
        else:
            # Câu mới hoặc chưa có rate controller, gửi ngay
            await send_tts_message(conn, "sentence_start", text)

    await sendAudio(conn, audios)
    # Gửi thông điệp đánh dấu bắt đầu câu
    if sentenceType is not SentenceType.MIDDLE:
        conn.logger.bind(tag=TAG).debug(
            f"Gửi thông điệp âm thanh: {sentenceType}, {text}"
        )

    # Gửi thông điệp kết thúc (nếu đây là đoạn văn bản cuối cùng)
    if conn.llm_finish_task and sentenceType == SentenceType.LAST:
        await send_tts_message(conn, "stop", None)
        conn.client_is_speaking = False
        if conn.close_after_chat:
            await conn.close()


async def _wait_for_audio_completion(conn: ConnectionHandler):
    """
    Chờ hàng đợi âm thanh rỗng và chờ các gói pre-buffer phát xong

    Args:
        conn: Đối tượng kết nối
    """
    if hasattr(conn, "audio_rate_controller") and conn.audio_rate_controller:
        rate_controller = conn.audio_rate_controller
        conn.logger.bind(tag=TAG).debug(
            f"Đang chờ gửi âm thanh hoàn tất, còn {len(rate_controller.queue)} gói trong hàng đợi"
        )
        await rate_controller.queue_empty_event.wait()

        # Chờ các gói pre-buffer phát xong
        # N gói đầu tiên được gửi trực tiếp, thêm 2 gói network jitter, cần chờ thêm thời gian cho chúng phát xong trên client
        frame_duration_ms = rate_controller.frame_duration
        pre_buffer_playback_time = (PRE_BUFFER_COUNT + 2) * frame_duration_ms / 1000.0
        await asyncio.sleep(pre_buffer_playback_time)

        conn.logger.bind(tag=TAG).debug("Gửi âm thanh hoàn tất")


def calculate_timestamp_and_sequence(conn: ConnectionHandler, start_time, packet_index, frame_duration=60):
    """
    Tính toán timestamp và số thứ tự cho gói dữ liệu âm thanh
    Args:
        conn: Đối tượng kết nối
        start_time: Thời điểm bắt đầu (giá trị bộ đếm hiệu năng)
        packet_index: Chỉ số gói dữ liệu
        frame_duration: Thời lượng mỗi khung (ms), phù hợp với mã hóa Opus
    Returns:
        tuple: (timestamp, sequence)
    """
    # Tính toán timestamp dựa trên vị trí phát
    timestamp = int((start_time + packet_index * frame_duration / 1000) * 1000) % (
        2**32
    )

    # Tính toán số thứ tự
    if hasattr(conn, "audio_flow_control"):
        sequence = conn.audio_flow_control["sequence"]
    else:
        sequence = (
            packet_index  # Nếu không có trạng thái điều khiển luồng thì dùng chỉ số gốc
        )

    return timestamp, sequence


async def _send_to_mqtt_gateway(conn: ConnectionHandler, opus_packet, timestamp, sequence):
    """
    Gửi gói Opus kèm header 4 byte Binary Protocol V3 tới mqtt_gateway.
    Args:
        conn: Đối tượng kết nối
        opus_packet: Gói dữ liệu Opus
        timestamp: Timestamp (không truyền đi trong V3, giữ cho tương thích API)
        sequence: Số thứ tự gói (không dùng trong V3)
    """
    # Header V3: 4 bytes
    # [0] type, [1] reserved, [2-3] payload_size
    payload_len = len(opus_packet)
    if payload_len > 0xFFFF:
        raise ValueError("Kích thước khung Opus vượt quá giới hạn 65KB của Binary V3")

    header = struct.pack(">BBH", 0, 0, payload_len)

    complete_packet = header + opus_packet
    await conn.send_raw(complete_packet)


def _get_or_create_rate_controller(conn: ConnectionHandler, frame_duration, is_single_packet):
    """
    Lấy hoặc tạo RateController và flow_control

    Args:
        conn: Đối tượng kết nối
        frame_duration: Thời lượng khung
        is_single_packet: Chế độ gói đơn (True: TTS streaming gói đơn, False: gói hàng loạt)

    Returns:
        (rate_controller, flow_control)
    """
    # Kiểm tra cần reset: chế độ gói đơn và sentence_id thay đổi, hoặc controller chưa tồn tại
    need_reset = (
        is_single_packet
        and getattr(conn, "audio_flow_control", {}).get("sentence_id")
        != conn.sentence_id
    ) or not hasattr(conn, "audio_rate_controller")

    if need_reset:
        # Tạo hoặc lấy rate_controller
        if not hasattr(conn, "audio_rate_controller"):
            conn.audio_rate_controller = AudioRateController(frame_duration)
        else:
            conn.audio_rate_controller.reset()

        # Khởi tạo flow_control
        conn.audio_flow_control = {
            "packet_count": 0,
            "sequence": 0,
            "sentence_id": conn.sentence_id,
        }

        # Khởi động background sender loop
        _start_background_sender(
            conn, conn.audio_rate_controller, conn.audio_flow_control
        )

    return conn.audio_rate_controller, conn.audio_flow_control


def _start_background_sender(conn: ConnectionHandler, rate_controller, flow_control):
    """
    Khởi động task gửi nền

    Args:
        conn: Đối tượng kết nối
        rate_controller: Bộ điều khiển tốc độ
        flow_control: Trạng thái điều khiển luồng
    """

    async def send_callback(packet):
        # Kiểm tra có nên hủy không
        if conn.client_abort:
            raise asyncio.CancelledError("Client đã hủy")

        conn.last_activity_time = time.time() * 1000
        await _do_send_audio(conn, packet, flow_control)
        conn.client_is_speaking = True

    # Sử dụng start_sending để khởi động loop nền
    rate_controller.start_sending(send_callback)


async def _send_audio_with_rate_control(
    conn: ConnectionHandler, audio_list, rate_controller, flow_control, send_delay
):
    """
    Gửi audio packets với rate_controller

    Args:
        conn: Đối tượng kết nối
        audio_list: Danh sách gói âm thanh
        rate_controller: Bộ điều khiển tốc độ
        flow_control: Trạng thái điều khiển luồng
        send_delay: Độ trễ cố định (giây), -1 nghĩa là dùng flow control động
    """
    for packet in audio_list:
        if conn.client_abort:
            return

        conn.last_activity_time = time.time() * 1000

        # Pre-buffer: N gói đầu tiên gửi trực tiếp
        if flow_control["packet_count"] < PRE_BUFFER_COUNT:
            await _do_send_audio(conn, packet, flow_control)
            conn.client_is_speaking = True
        elif send_delay > 0:
            # Chế độ độ trễ cố định
            await asyncio.sleep(send_delay)
            await _do_send_audio(conn, packet, flow_control)
            conn.client_is_speaking = True
        else:
            # Chế độ flow control động: chỉ thêm vào queue, để background loop gửi
            rate_controller.add_audio(packet)


async def _do_send_audio(conn: ConnectionHandler, opus_packet, flow_control):
    """
    Thực hiện gửi audio thực tế
    """
    packet_index = flow_control.get("packet_count", 0)
    sequence = flow_control.get("sequence", 0)

    if conn.conn_from_mqtt_gateway:
        # Tính timestamp (dựa trên vị trí phát)
        start_time = time.time()
        timestamp = int(start_time * 1000) % (2**32)
        await _send_to_mqtt_gateway(conn, opus_packet, timestamp, sequence)
    else:
        # Gửi trực tiếp gói opus
        await conn.send_raw(opus_packet)

    # Cập nhật trạng thái flow control
    flow_control["packet_count"] = packet_index + 1
    flow_control["sequence"] = sequence + 1


# Phát âm thanh
async def sendAudio(conn: ConnectionHandler, audios, frame_duration=AUDIO_FRAME_DURATION):
    """
    Gửi gói âm thanh, sử dụng AudioRateController để điều khiển luồng chính xác

    Args:
        conn: Đối tượng kết nối
        audios: Gói opus đơn (bytes) hoặc danh sách gói opus
        frame_duration: Thời lượng khung (ms), mặc định sử dụng hằng số AUDIO_FRAME_DURATION
    """
    if audios is None or len(audios) == 0:
        return

    send_delay = conn.config.get("tts_audio_send_delay", -1) / 1000.0
    is_single_packet = isinstance(audios, bytes)

    # Khởi tạo hoặc lấy RateController
    rate_controller, flow_control = _get_or_create_rate_controller(
        conn, frame_duration, is_single_packet
    )

    # Chuyển đổi thống nhất sang danh sách để xử lý
    audio_list = [audios] if is_single_packet else audios

    # Gửi audio packets
    await _send_audio_with_rate_control(
        conn, audio_list, rate_controller, flow_control, send_delay
    )


async def send_tts_message(conn: ConnectionHandler, state, text=None):
    """Gửi thông điệp trạng thái TTS"""
    if text is None and state == "sentence_start":
        return
    message = {"type": "tts", "state": state, "session_id": conn.session_id}
    if text is not None:
        message["text"] = textUtils.check_emoji(text)

    # Khi phát TTS kết thúc
    if state == "stop":
        # Phát âm báo
        tts_notify = conn.config.get("enable_stop_tts_notify", False)
        if tts_notify:
            stop_tts_notify_voice = conn.config.get(
                "stop_tts_notify_voice", "config/assets/tts_notify.mp3"
            )
            audios = await audio_to_data(stop_tts_notify_voice, is_opus=True)
            await sendAudio(conn, audios)

        # Chờ tất cả audio packets gửi xong
        await _wait_for_audio_completion(conn)
        # Xóa trạng thái máy chủ đang nói
        conn.clearSpeakStatus()

    # Gửi thông điệp tới client
    await conn.send_raw(json.dumps(message))


async def send_stt_message(conn: ConnectionHandler, text: str):
    """Gửi thông điệp trạng thái STT"""
    end_prompt_str = conn.config.get("end_prompt", {}).get("prompt")
    if end_prompt_str and end_prompt_str == text:
        await send_tts_message(conn, "start")
        return

    # Phân tích định dạng JSON để trích xuất nội dung người dùng thực sự nói
    display_text = text
    try:
        # Thử phân tích định dạng JSON
        if text.strip().startswith("{") and text.strip().endswith("}"):
            parsed_data = json.loads(text)
            if isinstance(parsed_data, dict) and "content" in parsed_data:
                # Nếu là JSON có chứa thông tin người nói thì chỉ hiển thị phần content
                display_text = parsed_data["content"]
                # Lưu thông tin người nói vào đối tượng conn
                if "speaker" in parsed_data:
                    conn.current_speaker = parsed_data["speaker"]
    except (json.JSONDecodeError, TypeError):
        # Nếu không phải JSON thì dùng nguyên văn bản gốc
        display_text = text
    stt_text = textUtils.get_string_no_punctuation_or_emoji(display_text)
    await conn.send_raw(
        json.dumps({"type": "stt", "text": stt_text, "session_id": conn.session_id})
    )
    conn.client_is_speaking = True
    await send_tts_message(conn, "start")
