from dataclasses import dataclass


class FieldValidationError(Exception):
    def __init__(self, field_label: str):
        self.message = f"Provide a value or an override reason for {field_label}."
        super().__init__(self.message)


@dataclass
class ResolvedField:
    value: str | None
    source: str  # "ocr" | "manual" | "override"
    override_reason: str | None


def resolve_field(value: str | None, override_reason: str | None, ocr_guess: str | None, field_label: str) -> ResolvedField:
    """Decides what actually gets saved for one confirmed-product field, and
    tags where it came from. The server decides `source` itself by comparing
    against the OCR guess already on file -- the client only ever sends the
    raw value, never a self-reported source tag (SECURITY_CHECKLIST.md:
    never trust the client for anything the server can determine itself)."""
    value = value.strip() if value else None
    override_reason = override_reason.strip() if override_reason else None

    if value:
        source = "ocr" if ocr_guess is not None and value == ocr_guess else "manual"
        return ResolvedField(value=value, source=source, override_reason=None)

    if override_reason:
        return ResolvedField(value=None, source="override", override_reason=override_reason)

    raise FieldValidationError(field_label)
