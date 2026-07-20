import csv
import io

from fastapi.responses import Response
from openpyxl import Workbook

# Excel/Sheets/LibreOffice treat a cell starting with any of these as a
# formula, not text (CWE-1236) -- product_name/price can come straight from
# OCR reading a photographed label, so a crafted or misread label could plant
# a live formula (e.g. "=HYPERLINK(...)") that runs when the export is
# opened. Prefixing with a leading apostrophe forces every spreadsheet
# program to treat the cell as plain text instead of evaluating it.
_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@", "\t", "\r")


def escape_for_spreadsheet(value: str) -> str:
    if value.startswith(_FORMULA_TRIGGER_CHARS):
        return f"'{value}"
    return value


def build_spreadsheet_response(
    format: str, headers: list[str], rows: list[list[str]], filename_base: str, sheet_title: str
) -> Response:
    if format == "csv":
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(headers)
        writer.writerows(rows)
        return Response(
            content=buffer.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = sheet_title
    sheet.append(headers)
    for row in rows:
        sheet.append(row)

    buffer = io.BytesIO()
    workbook.save(buffer)
    return Response(
        content=buffer.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename_base}.xlsx"'},
    )
