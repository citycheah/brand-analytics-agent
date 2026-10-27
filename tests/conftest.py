import asyncio
import inspect
import os
import pytest

os.environ.setdefault("GOOGLE_CLOUD_PROJECT", "local-demo-project")
os.environ.setdefault("NO_GCE_CHECK", "True")
os.environ.setdefault("OAUTH_GOOGLE_CLIENT_ID", "mock-client-id")
os.environ.setdefault("OAUTH_GOOGLE_CLIENT_SECRET", "mock-client-secret")

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
