import pytest

from brand_analytics_app.tools import validate_and_sanitize_keywords


def test_lowercase_and_strip_at() -> None:
    identities = [
        {
            "brand_name": "BMW",
            "handles": ["@BMW_DE", "BMWGroup"],
            "domains": ["BMW.com"],
            "aliases": ["Bayerische Motoren Werke"],
        }
    ]
    cleaned = validate_and_sanitize_keywords(identities)
    assert cleaned[0]["handles"] == ["bmw_de", "bmwgroup"]
    assert cleaned[0]["domains"] == ["bmw.com"]
    assert cleaned[0]["aliases"] == ["bayerische motoren werke"]


def test_exact_overlap_prohibited() -> None:
    identities = [
        {
            "brand_name": "Haribo",
            "handles": ["gummibaerchen"],
            "domains": [],
            "aliases": [],
        },
        {
            "brand_name": "Katjes",
            "handles": ["gummibaerchen"],
            "domains": [],
            "aliases": [],
        },
    ]
    with pytest.raises(ValueError) as excinfo:
        validate_and_sanitize_keywords(identities)
    assert "Duplicate keyword(s)" in str(excinfo.value)


def test_substring_overlap_prohibited() -> None:
    identities = [
        {"brand_name": "Dior", "handles": ["dior"], "domains": [], "aliases": []},
        {
            "brand_name": "Dior Fashion",
            "handles": ["dior_fashion"],  # Substring overlap with "dior"
            "domains": [],
            "aliases": [],
        },
    ]
    with pytest.raises(ValueError) as excinfo:
        validate_and_sanitize_keywords(identities)
    assert "Keyword overlap detected" in str(excinfo.value)
