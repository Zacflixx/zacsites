"""Local multi-device checker. Install: pip install playwright; playwright install chromium.

Usage:
    python device_test.py https://xaltteams.com --headed
    python device_test.py --config device-lab.json --headed --full-page

Each device gets its own isolated Chromium context. In headed mode, keep testing,
then press Enter in the terminal to capture final screenshots and close windows.
This emulates viewports and touch, not the Safari browser or physical devices.
"""
import argparse
import asyncio
import json
import re
from pathlib import Path
from urllib.parse import urlparse

DEFAULTS = [
    {"name": "Desktop", "viewport": {"width": 1440, "height": 900}, "is_mobile": False, "has_touch": False},
    {"name": "Tablet", "viewport": {"width": 820, "height": 1180}, "is_mobile": True, "has_touch": True},
    {"name": "Mobile", "viewport": {"width": 390, "height": 844}, "is_mobile": True, "has_touch": True},
]


def read_settings(args):
    data = json.loads(Path(args.config).read_text(encoding="utf-8")) if args.config else {}
    url = args.url or data.get("url")
    if not isinstance(url, str):
        raise ValueError("Supply a URL or --config device-lab.json.")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use an HTTP or HTTPS URL without embedded credentials.")
    devices = data.get("devices", DEFAULTS)
    if not isinstance(devices, list) or not 1 <= len(devices) <= 6:
        raise ValueError("Use one to six device configurations.")
    checked = []
    for index, device in enumerate(devices):
        viewport = device.get("viewport", {})
        if any(type(viewport.get(k)) is not int or not 240 <= viewport[k] <= 3840 for k in ("width", "height")):
            raise ValueError("Viewport dimensions must be integers between 240 and 3840.")
        checked.append({"name": str(device.get("name", f"Device {index + 1}"))[:70],
                        "viewport": {k: viewport[k] for k in ("width", "height")},
                        "is_mobile": bool(device.get("is_mobile", False)),
                        "has_touch": bool(device.get("has_touch", False))})
    if args.devices:
        checked = [d for d in checked if d["name"].lower() in {n.lower() for n in args.devices}]
        if not checked:
            raise ValueError("None of the requested device names match the configuration.")
    if not 0 <= args.wait <= 60000:
        raise ValueError("--wait must be between 0 and 60000 milliseconds.")
    return url, checked


async def main():
    parser = argparse.ArgumentParser(description="Isolated multi-device website checks.")
    parser.add_argument("url", nargs="?")
    parser.add_argument("--config", help="JSON exported from Isaac Device Lab")
    parser.add_argument("--devices", nargs="+", help="Device names, e.g. Desktop Mobile")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--full-page", action="store_true")
    parser.add_argument("--wait", type=int, default=2000)
    parser.add_argument("--out", default="screenshots")
    args = parser.parse_args()
    try:
        url, devices = read_settings(args)
    except (ValueError, OSError, TypeError, AttributeError) as exc:
        parser.error(str(exc))
    # Deferred import keeps --help and config validation usable without Playwright installed.
    from playwright.async_api import async_playwright
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {"url": url, "devices": []}
    contexts = []
    pages = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not args.headed)
        try:
            async def run_device(index, device):
                name = device["name"]
                item = {"name": name, "viewport": device["viewport"], "errors": []}
                report["devices"].append(item)
                safe_name = re.sub(r"[^a-zA-Z0-9_-]", "_", name).strip("_") or "device"
                shot = out / f"{index + 1:02d}-{safe_name}.png"
                try:
                    context = await browser.new_context(**{k: v for k, v in device.items() if k != "name"})
                    contexts.append(context)
                    page = await context.new_page()
                    page.on("pageerror", lambda error: item["errors"].append(str(error)))
                    response = await page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    await page.wait_for_timeout(args.wait)
                    item["status"] = response.status if response else None
                    await page.screenshot(path=str(shot), full_page=args.full_page)
                    item["screenshot"] = str(shot)
                    pages.append((page, shot, item))
                    print(f'[{name}] HTTP {item["status"]} -> {shot}')
                except Exception as exc:
                    item["failure"] = str(exc)
                    print(f"[{name}] failed: {exc}")
            await asyncio.gather(*(run_device(i, d) for i, d in enumerate(devices)))
            if args.headed:
                try:
                    await asyncio.to_thread(input, "Browsers remain open. Test or log in independently; press Enter to capture final screenshots and finish. ")
                except EOFError:
                    pass
                for page, shot, item in pages:
                    try:
                        await page.screenshot(path=str(shot), full_page=args.full_page)
                        item["final_url"] = page.url
                    except Exception as exc:
                        item["final_capture_error"] = str(exc)
            for item in report["devices"]:
                for error in item["errors"][:5]:
                    print(f'[{item["name"]}] JS error: {error}')
        finally:
            await asyncio.gather(*(c.close() for c in contexts), return_exceptions=True)
            await browser.close()
            report_path = out / "report.json"
            report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            print(f"Report: {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
