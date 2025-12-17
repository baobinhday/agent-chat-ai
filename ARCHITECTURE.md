# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Home Chat Bot application - an AI-powered chat application with MCP integration, audio streaming, MQTT support, and advanced features. The system is built with a React frontend and FastAPI backend, using PostgreSQL for persistence and Redis for caching.

## Architecture

The application follows a microservices architecture with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS + Jotai state management
- **Backend**: FastAPI with PostgreSQL, Redis, MQTT, and AI integration
- **Database**: PostgreSQL 14+ with SQLAlchemy ORM and Alembic migrations
- **Cache/Message Broker**: Redis
- **Real-time Communication**: WebSocket, MQTT, streaming responses
- **AI Integration**: Model Context Protocol (MCP) support, OpenAI, Google Generative AI
- **Audio Processing**: Text-to-speech, speech-to-text capabilities

## Key Components

- **Backend Services**: Thread pool, authentication manager, reminder service, MQTT service, scheduler
- **AI Modules**: MCP integration for AI model context protocol
- **Real-time Features**: WebSocket connections, audio processing worklets
- **Authentication**: JWT-based with OAuth2 support

## Development Commands

### Docker Compose Management (via Makefile)
```bash
make dev                    # Start development environment
make prod                   # Start production environment
make down                   # Stop all containers
make build                  # Build all Docker images
make rebuild                # Rebuild images without cache
make logs                   # View logs from all services
make logs-backend           # View backend logs
make logs-frontend          # View frontend logs
make ps                     # Show running containers
```

### Database Management
```bash
make migrate                # Run database migrations
make db-shell               # Access PostgreSQL shell
make db-backup              # Backup database
make db-restore FILE='backup.sql.gz'  # Restore database
```

### Redis Management
```bash
make redis-shell            # Access Redis CLI
make redis-info             # Show Redis info
```

### Testing & Quality
```bash
make test                   # Run backend tests
make coverage               # Generate coverage report
make lint                   # Lint code
```

### Shell Access
```bash
make shell-backend          # SSH into backend container
make shell-frontend         # SSH into frontend container
```

### Health & Monitoring
```bash
make health                 # Check service health
make stats                  # Show container resource usage
```

## Direct Commands (without Docker)

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd src
alembic upgrade head
cd ..
python run.py
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

## Testing

### Backend Tests
```bash
make test                    # Run tests
make coverage                # Coverage report
cd backend && docker compose exec -T backend pytest -v  # Run tests directly
```

### Frontend Tests
```bash
cd frontend
npm run test
```

## Environment Configuration

Key environment variables are defined in the `.env` file, including:
- Database connection (DATABASE_URL)
- Redis connection (REDIS_URL)
- JWT secrets (SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES)
- LLM API keys (OPENAI_API_KEY, GOOGLE_API_KEY)
- MQTT configuration (MQTT_BROKER, MQTT_PORT)
- Logging level (LOG_LEVEL)

## File Structure

- `backend/src/app/` - Main backend application with API routes, models, schemas, services
- `frontend/src/` - Frontend source with components, pages, hooks, services, store
- `data/` - Persistent data volumes for PostgreSQL, Redis, backend logs, MCP config
- `scripts/` - Helper scripts
- `docker-compose.yml` - Main Docker Compose configuration
- `Makefile` - All development commands

## Important Notes

- The backend uses a custom lifespan manager for startup/shutdown of real-time components
- Real-time features include Thread pool service, MQTT service, reminder service, and scheduler
- AI modules are initialized via the module factory system
- The application supports multi-language (i18n) via the frontend
- Audio processing uses Web Audio API and worklets for real-time processing