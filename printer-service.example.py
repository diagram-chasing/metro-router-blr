"""
Minimal print bridge for the BMRCL receipt kiosk.

The web app encodes the receipt to ESC/POS *in the browser* and POSTs the raw bytes
to /api/print, which forwards them here. This service's only job is to write those
bytes to the thermal printer — no rendering, no receipt logic.

Point the app at this service with the PRINT_SERVICE_URL env var
(defaults to http://127.0.0.1:8000/print).

If you already have a Python service that talks to the printer, you only need to add
the `/print` route below and call your existing "send raw bytes" function from it.

Run this reference version:
    pip install flask
    python printer-service.example.py
"""

from flask import Flask, request

app = Flask(__name__)


@app.post("/print")
def print_receipt():
    data = request.get_data()  # raw ESC/POS bytes from /api/print
    if not data:
        return ("empty payload", 400)
    send_to_printer(data)
    return ("", 204)


def send_to_printer(data: bytes) -> None:
    """Write raw ESC/POS bytes to the printer. Pick ONE transport for your setup."""

    # A) USB raw character device (Linux, usblp driver) — simplest if it exists:
    with open("/dev/usb/lp0", "wb") as f:
        f.write(data)

    # B) python-escpos over USB (robust across firmware). Find VID/PID with `lsusb`:
    #     from escpos.printer import Usb
    #     Usb(0x0416, 0x5011)._raw(data)

    # C) Network/Wi-Fi printer (ESC/POS over TCP port 9100):
    #     import socket
    #     s = socket.socket(); s.connect(("192.168.1.50", 9100))
    #     s.sendall(data); s.close()

    # D) Serial:
    #     import serial
    #     serial.Serial("/dev/ttyUSB0", 115200).write(data)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)
