from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse


BASE_DIR = Path(__file__).resolve().parent
ALLOWED_ASSETS = {
    "driver-dashboard.css",
    "driver-dashboard.html",
    "driver-dashboard.js",
    "icon.jpg",
    "index1.html",
    "local-api.js",
    "moto.png.png",
    "script.js",
    "style.css",
}

app = FastAPI(title="Veloz", docs_url=None, redoc_url=None, openapi_url=None)


def page(filename: str) -> FileResponse:
    return FileResponse(BASE_DIR / filename)


@app.get("/")
@app.get("/inicio")
def home_page() -> FileResponse:
    return page("index1.html")


@app.get("/painel")
def driver_panel_page() -> FileResponse:
    return page("driver-dashboard.html")


@app.get("/login")
def login_page() -> RedirectResponse:
    return RedirectResponse("/?tipo=cliente#login", status_code=303)


@app.get("/cadastro")
def registration_page() -> RedirectResponse:
    return RedirectResponse("/?tipo=cliente#cadastro", status_code=303)


@app.get("/entrega")
def delivery_page() -> RedirectResponse:
    return RedirectResponse("/#enviar-pedido", status_code=303)


@app.get("/admin-entregas")
def admin_page() -> RedirectResponse:
    return RedirectResponse("/inicio", status_code=303)


@app.get("/{asset_name}")
def asset(asset_name: str) -> FileResponse:
    if asset_name not in ALLOWED_ASSETS:
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
    return page(asset_name)
