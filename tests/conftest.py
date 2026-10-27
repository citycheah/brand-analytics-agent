import asyncio
import inspect
import os
import pytest

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "local-demo-project")
os.environ.setdefault("NO_GCE_CHECK", "True")
os.environ.setdefault("OAUTH_GOOGLE_CLIENT_ID", "mock-client-id")
os.environ.setdefault("OAUTH_GOOGLE_CLIENT_SECRET", "mock-client-secret")

os.environ.setdefault("GEMINI_API_KEY", "mock-api-key")
os.environ.setdefault("GOOGLE_API_KEY", "mock-api-key")

try:
    import google.auth
    import google.auth.credentials
    import google.cloud.aiplatform as aiplatform

    aiplatform.init(
        project="local-demo-project",
        credentials=google.auth.credentials.AnonymousCredentials(),
    )

    # Provide fallback for google.auth.default() in headless CI runners without ADC credentials
    try:
        google.auth.default()
    except Exception:
        def _mock_default(*args, **kwargs):
            return google.auth.credentials.AnonymousCredentials(), "local-demo-project"

        google.auth.default = _mock_default
except Exception:
    pass

try:
    from google.adk.models.google_llm import Gemini
    from google.adk.models.llm_response import LlmResponse
    from google.genai import types

    _orig_generate_content_async = Gemini.generate_content_async

    async def _mock_generate_content_async(self, llm_request, stream=False):
        if (
            os.environ.get("INTEGRATION_TEST") == "TRUE"
            or not os.environ.get("GEMINI_API_KEY")
            or os.environ.get("GEMINI_API_KEY") == "mock-api-key"
        ):
            yield LlmResponse(
                content=types.Content(
                    role="model",
                    parts=[
                        types.Part.from_text(
                            text="Welcome to Brand Analytics! I am ready to help."
                        )
                    ],
                )
            )
        else:
            async for resp in _orig_generate_content_async(self, llm_request, stream=stream):
                yield resp

    Gemini.generate_content_async = _mock_generate_content_async
except Exception:
    pass


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "asyncio: mark test as an async coroutine (fallback runner)"
    )


@pytest.hookimpl(tryfirst=True)
def pytest_pyfunc_call(pyfuncitem: pytest.Function) -> bool | None:
    """Fallback async test runner when pytest-asyncio is not installed in the active environment."""
    if pyfuncitem.config.pluginmanager.has_plugin("asyncio"):
        return None
    testfunction = pyfuncitem.obj
    if inspect.iscoroutinefunction(testfunction):
        funcargs = pyfuncitem.funcargs
        testargs = {arg: funcargs[arg] for arg in pyfuncitem._fixtureinfo.argnames}
        asyncio.run(testfunction(**testargs))
        return True
    return None
