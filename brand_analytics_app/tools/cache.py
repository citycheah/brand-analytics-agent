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
"""Shared in-memory cache for tools with bounded capacity."""


class _BoundedCache(dict):
    """Dict subclass with a max size limit. Evicts oldest entry on overflow."""

    def __init__(self, maxsize: int = 50):
        super().__init__()
        self._maxsize = maxsize

    def __setitem__(self, key, value):
        if len(self) >= self._maxsize and key not in self:
            oldest = next(iter(self))
            del self[oldest]
        super().__setitem__(key, value)


REPORT_CACHE: dict[str, dict] = _BoundedCache(maxsize=50)
