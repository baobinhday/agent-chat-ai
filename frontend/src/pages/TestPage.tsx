const TestPage = () => {
  return (
    <div className="h-full w-full">
      <iframe
        src="/test/test_page.html"
        className="w-full h-full border-0"
        title="Xiaozhi Server Test Page"
        style={{ minHeight: '100vh' }}
      />
    </div>
  );
};

export default TestPage;
