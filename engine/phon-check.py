"""Print how the phonemiser (the one Kokoro uses) reads each term, to find words that need a respelling.
Usage (inside the Kokoro venv): python phon-check.py ["term" ...]   (no arguments: a built-in list of SAP and IT terms)"""
import sys
from kokoro_onnx.tokenizer import Tokenizer
t = Tokenizer()
terms = sys.argv[1:] or ["SAP", "BTP", "AI", "ST22", "ATC", "QA", "DEV", "dev", "PRD", "IDoc", "IDocs", "eye-dock", "ABAP", "ah-bap", "RAP", "CDS",
    "OData", "oh-data", "iFlow", "CPI", "MPL", "PII", "SOX", "socks", "GxP", "G x P", "S/4HANA", "S4HANA", "HANA", "UI5", "UI five", "Fiori",
    "Z-table", "zed table", "zee table", "MCP", "JWT", "SE09", "SE38", "G/L", "GL account", "EDI", "ERP", "CTS", "JSON", "API", "OAuth",
    "SSO", "CIO", "RFC", "BAPI", "Gateway", "ECC", "S/4", "UI", "FLP", "BSP", "SRVB", "BDEF", "Q A", "S T 22", "a.m.", "3 a.m.", "GUI",
    "IT", "CFO", "DDIC", "ACDOCA", "EKBE", "GL", "CDS view", "HTTP", "URL", "PDF", "e-mail", "email", "Larkwell", "Larkwell Copilot"]
for s in terms:
    print(f"{s!r:34} {t.phonemize(s, lang='en-us')}")
