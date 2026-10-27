# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Sandboxed Python code execution tool."""
import ast
import os
import subprocess
import sys
import tempfile
import time

from brand_analytics_app.tools.data_loader import _load_query_results


def _sandbox_env() -> dict:
    """Minimal allow-listed env for the sandbox subprocess: no GCP creds, no secrets."""
    keep = {
        "PATH",
        "PYTHONPATH",
        "LANG",
        "LC_ALL",
        "SYSTEMROOT",
        "TEMP",
        "TMP",
        "HOME",
    }
    return {k: v for k, v in os.environ.items() if k in keep}


def sandboxed_python_interpreter(script: str, data_uri: str | None = None) -> dict:
    """Restricted Python executor. A pandas DataFrame `df` is pre-loaded from data_uri
    (if provided) so the script never touches GCS, credentials, or the filesystem.

    Args:
        script: Dynamic python script block to run.
        data_uri: Optional query handle URI (gs://... or file://...) to load into `df`.

    Returns:
        Dict containing success status, stdout output, or validation error.
    """
    # 1. Parse AST to validate code safety
    try:
        root = ast.parse(script)
    except SyntaxError as e:
        return {"status": "error", "error": f"Syntax Error: {e!s}"}

    # Prohibited modules
    blocked_imports = {
        "socket",
        "subprocess",
        "urllib",
        "requests",
        "shutil",
        "webbrowser",
        "ctypes",
        "os",
        "sys",
        "importlib",
        "builtins",
    }

    for node in ast.walk(root):
        # Block 'import x' statements
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.split(".")[0] in blocked_imports:
                    return {
                        "status": "error",
                        "error": f"Execution blocked: import of '{alias.name}' is prohibited.",
                    }

        # Block 'from x import y' statements
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.split(".")[0] in blocked_imports:
                return {
                    "status": "error",
                    "error": f"Execution blocked: import from '{node.module}' is prohibited.",
                }

        # Block open() calls that write or modify files outside current path
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in {"__import__", "eval", "exec", "compile"}:
                return {
                    "status": "error",
                    "error": f"Execution blocked: '{node.func.id}' is prohibited.",
                }

            if node.func.id == "open":
                # Check write arguments if open() is called
                has_write_mode = False
                if len(node.args) >= 2:
                    mode_arg = node.args[1]
                    if isinstance(mode_arg, ast.Constant) and any(
                        m in str(mode_arg.value) for m in ["w", "a", "x", "+"]
                    ):
                        has_write_mode = True

                # Check keyword arguments (e.g. open(file, mode="w"))
                for kw in node.keywords:
                    if (
                        kw.arg == "mode"
                        and isinstance(kw.value, ast.Constant)
                        and any(m in str(kw.value) for m in ["w", "a", "x", "+"])
                    ):
                        has_write_mode = True

                if has_write_mode:
                    return {
                        "status": "error",
                        "error": "Execution blocked: write mode in 'open()' is prohibited.",
                    }

    # 2. Pre-stage data locally
    temp_dir = tempfile.gettempdir()
    local_parquet = None
    preamble = "# -*- coding: utf-8 -*-\nimport pandas as pd\n"

    if data_uri:
        try:
            df = _load_query_results({"gcs_uri": data_uri})
        except Exception as e:
            return {"status": "error", "error": f"Failed to load dataset: {e!s}"}
        local_parquet = os.path.join(
            temp_dir, f"sandbox_data_{os.getpid()}_{time.time_ns()}.parquet"
        )
        df.to_parquet(local_parquet, index=False)
        # repr() handles Windows backslashes safely
        preamble += f"df = pd.read_parquet({local_parquet!r})\n"

    full_script = preamble + "\n" + script

    # 3. Execute with stripped env
    temp_file = os.path.join(temp_dir, f"sandbox_run_{os.getpid()}_{time.time_ns()}.py")

    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            f.write(full_script)

        # Run script with local python runner and capture stdout/stderr
        res = subprocess.run(
            [sys.executable, temp_file],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30.0,
            env=_sandbox_env(),
        )

        if res.returncode == 0:
            return {"status": "success", "output": res.stdout}
        else:
            return {"status": "error", "error": f"Runtime Error: {res.stderr}"}
    except subprocess.TimeoutExpired:
        return {
            "status": "error",
            "error": "Execution blocked: process exceeded 30.0 second timeout limit.",
        }
    except Exception as e:
        return {"status": "error", "error": f"Execution failed: {e!s}"}
    finally:
        for p in (temp_file, local_parquet):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
