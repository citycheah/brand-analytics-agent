import asyncio
import os
import sqlite3
import tempfile
from datetime import UTC
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.exc import OperationalError

from frontend.app import (
    SafeSQLAlchemyDataLayer,
    init_db,
    schedule_db_sync,
    sync_db_to_storage,
)


@pytest.fixture
def temp_db_dir():
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmpdir:
        yield tmpdir


def test_init_db_restores_from_gcs_when_available(
    temp_db_dir: str, monkeypatch: pytest.MonkeyPatch
):
    """Test 1: Verify init_db() downloads existing DB from GCS (bypassing FUSE) when local DB does not exist."""
    local_db = os.path.join(temp_db_dir, "data.db")
    monkeypatch.setattr("frontend.app.LOCAL_DB_PATH", local_db)
    monkeypatch.setattr(
        "frontend.app.DATABASE_URL", f"sqlite+aiosqlite:///{local_db}"
    )

    mock_storage_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()

    # Simulate blob existing in GCS
    mock_blob.exists.return_value = True

    def fake_download(dest):
        # Create a valid sqlite DB file at dest
        conn = sqlite3.connect(dest)
        conn.execute("CREATE TABLE dummy (id TEXT)")
        conn.commit()
        conn.close()

    mock_blob.download_to_filename.side_effect = fake_download
    mock_bucket.blob.return_value = mock_blob
    mock_storage_client.return_value.bucket.return_value = mock_bucket

    monkeypatch.setenv("ENABLE_GCS_SYNC", "1")
    with patch("google.cloud.storage.Client", mock_storage_client):
        init_db()

    assert os.path.exists(local_db)
    mock_blob.download_to_filename.assert_called_once_with(local_db)

    # Verify tables exist (including schema tables)
    conn = sqlite3.connect(local_db)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cursor.fetchall()]
    conn.close()
    assert "users" in tables
    assert "threads" in tables
    assert "steps" in tables


def test_init_db_first_boot_when_gcs_blob_not_found(
    temp_db_dir: str, monkeypatch: pytest.MonkeyPatch
):
    """Test 2: Verify init_db() handles first-ever boot gracefully when no blob exists in GCS."""
    local_db = os.path.join(temp_db_dir, "data.db")
    monkeypatch.setattr("frontend.app.LOCAL_DB_PATH", local_db)
    monkeypatch.setattr(
        "frontend.app.DATABASE_URL", f"sqlite+aiosqlite:///{local_db}"
    )
    monkeypatch.setenv("ENABLE_GCS_SYNC", "1")

    mock_storage_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()

    # Blob does NOT exist in GCS
    mock_blob.exists.return_value = False
    mock_bucket.blob.return_value = mock_blob
    mock_storage_client.return_value.bucket.return_value = mock_bucket

    with patch("google.cloud.storage.Client", mock_storage_client):
        init_db()

    assert os.path.exists(local_db)
    mock_blob.download_to_filename.assert_not_called()

    # Verify schema tables are created from scratch
    conn = sqlite3.connect(local_db)
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cursor.fetchall()]
    conn.close()
    assert "users" in tables
    assert "threads" in tables
    assert "steps" in tables


def test_sync_db_to_storage_creates_snapshot_and_uploads(
    temp_db_dir: str, monkeypatch: pytest.MonkeyPatch
):
    """Test 3: Verify sync_db_to_storage() creates a snapshot with sqlite3.backup() and uploads via GCS client."""
    local_db = os.path.join(temp_db_dir, "data.db")
    monkeypatch.setattr("frontend.app.LOCAL_DB_PATH", local_db)
    monkeypatch.setenv("ENABLE_GCS_SYNC", "1")

    # Initialize a valid local database
    conn = sqlite3.connect(local_db)
    conn.execute("CREATE TABLE test_data (val TEXT)")
    conn.execute("INSERT INTO test_data VALUES ('hello')")
    conn.commit()
    conn.close()

    mock_storage_client = MagicMock()
    mock_bucket = MagicMock()
    mock_blob = MagicMock()
    mock_bucket.blob.return_value = mock_blob
    mock_storage_client.return_value.bucket.return_value = mock_bucket

    with patch("google.cloud.storage.Client", mock_storage_client):
        sync_db_to_storage()

    mock_blob.upload_from_filename.assert_called_once()
    uploaded_path = mock_blob.upload_from_filename.call_args[0][0]
    # The temporary snapshot should have been removed after upload
    assert not os.path.exists(uploaded_path)


@pytest.mark.asyncio
async def test_schedule_db_sync_debounces_rapid_calls(
    monkeypatch: pytest.MonkeyPatch,
):
    """Test 4: Verify schedule_db_sync() debounces rapid calls within the debounce window."""
    sync_mock = MagicMock()
    monkeypatch.setattr("frontend.app.sync_db_to_storage", sync_mock)

    # Schedule 3 rapid syncs with 0.1s delay
    schedule_db_sync(delay_seconds=0.1)
    schedule_db_sync(delay_seconds=0.1)
    schedule_db_sync(delay_seconds=0.1)

    # Before the timer expires, sync should not have been called
    assert sync_mock.call_count == 0

    # Wait for debounce window to pass
    await asyncio.sleep(0.2)

    # Should only be called once
    assert sync_mock.call_count == 1


def test_safe_data_layer_engine_initialization(temp_db_dir: str):
    """Test 5: Verify SafeSQLAlchemyDataLayer initializes with pool_pre_ping=True and pool_recycle."""
    db_path = os.path.join(temp_db_dir, "test.db")
    conninfo = f"sqlite+aiosqlite:///{db_path}"

    layer = SafeSQLAlchemyDataLayer(conninfo=conninfo)
    assert layer.engine.pool._pre_ping is True
    assert layer.engine.pool._recycle == 300


@pytest.mark.asyncio
async def test_safe_data_layer_get_thread_handles_operational_error(
    temp_db_dir: str,
):
    """Test 6: Verify SafeSQLAlchemyDataLayer.get_thread() catches OperationalError, calls dispose(), retries, and falls back cleanly."""
    db_path = os.path.join(temp_db_dir, "test.db")
    conninfo = f"sqlite+aiosqlite:///{db_path}"

    layer = SafeSQLAlchemyDataLayer(conninfo=conninfo)

    call_count = 0

    async def failing_get_thread(thread_id: str):
        nonlocal call_count
        call_count += 1
        raise OperationalError("disk I/O error", params=None, orig=Exception("disk I/O error"))

    with patch.object(
        SafeSQLAlchemyDataLayer,
        "_orig_get_thread",
        side_effect=failing_get_thread,
        create=True,
    ):
        with patch(
            "sqlalchemy.ext.asyncio.AsyncEngine.dispose", new_callable=AsyncMock
        ) as mock_dispose:
            result = await layer.get_thread("test-thread-id")
            # Should have retried once (2 calls total)
            assert call_count == 2
            # Should have called engine.dispose()
            assert mock_dispose.call_count >= 1
            # Should safely return None instead of crashing
            assert result is None


@pytest.mark.asyncio
async def test_safe_data_layer_create_and_update_step_succeeds(
    temp_db_dir: str,
):
    """Test 7: Verify create_step and update_step writes succeed reliably in local SQLite."""
    from chainlit.context import init_http_context

    init_http_context(thread_id="thread-1")

    db_path = os.path.join(temp_db_dir, "test.db")
    conninfo = f"sqlite+aiosqlite:///{db_path}"

    # Initialize tables
    conn = sqlite3.connect(db_path)
    conn.execute("""
    CREATE TABLE users (id TEXT PRIMARY KEY, identifier TEXT NOT NULL UNIQUE, metadata TEXT NOT NULL, createdAt TEXT);
    """)
    conn.execute("""
    CREATE TABLE threads (id TEXT PRIMARY KEY, createdAt TEXT, name TEXT, userId TEXT, userIdentifier TEXT, tags TEXT, metadata TEXT);
    """)
    conn.execute("""
    CREATE TABLE steps (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, threadId TEXT NOT NULL,
        parentId TEXT, streaming BOOLEAN NOT NULL, waitForAnswer BOOLEAN, isError BOOLEAN,
        metadata TEXT, tags TEXT, input TEXT, output TEXT, createdAt TEXT, start TEXT, end TEXT,
        generation TEXT, showInput TEXT, language TEXT, defaultOpen BOOLEAN, autoCollapse BOOLEAN
    );
    """)
    conn.commit()
    conn.close()

    layer = SafeSQLAlchemyDataLayer(conninfo=conninfo)

    step_dict = {
        "id": "step-1",
        "name": "Test Step",
        "type": "user_message",
        "threadId": "thread-1",
        "streaming": False,
        "input": "Hello",
        "output": "World",
        "createdAt": "2026-09-21T00:00:00Z",
    }

    # Should create step without error
    await layer.create_step(step_dict)

    # Should update step without error
    step_dict["output"] = "Updated World"
    await layer.update_step(step_dict)

    # Verify in DB
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("SELECT output FROM steps WHERE id = 'step-1'")
    row = cursor.fetchone()
    conn.close()
    assert row is not None
    assert row[0] == "Updated World"
    await layer.engine.dispose()


@pytest.mark.asyncio
async def test_safe_data_layer_get_current_timestamp_utc(temp_db_dir: str):
    """Test 8: Verify get_current_timestamp() returns a valid UTC timestamp ending in 'Z'."""
    from datetime import datetime

    db_path = os.path.join(temp_db_dir, "test.db")
    conninfo = f"sqlite+aiosqlite:///{db_path}"
    layer = SafeSQLAlchemyDataLayer(conninfo=conninfo)

    ts = await layer.get_current_timestamp()
    assert isinstance(ts, str)
    assert ts.endswith("Z")

    parsed_dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    now_utc = datetime.now(UTC)
    diff = abs((now_utc - parsed_dt).total_seconds())
    assert diff < 5, f"Timestamp {ts} deviates from UTC now {now_utc} by {diff}s"
    await layer.engine.dispose()

