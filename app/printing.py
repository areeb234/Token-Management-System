import os
from datetime import datetime
from PIL import Image, ImageDraw, ImageFont
import sys
import subprocess

def _load_font(path: str, size: int):
    # fallback to default PIL font if Arial isn't available on some machines
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def _generate_token_image(token_no: int, dept: str, width: int, height: int):
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    scale = width / 384.0

    # Slightly smaller fonts for compact layout
    font_title  = _load_font("arialbd.ttf", int(32 * scale))
    font_big    = _load_font("arialbd.ttf", int(85 * scale))
    font_time   = _load_font("arialbd.ttf", int(26 * scale))
    font_small  = _load_font("arialbd.ttf", int(22 * scale))

    y = int(20 * scale)

    # TOKEN LABEL
    draw.text((width // 2, y),
              "TOKEN",
              fill="black",
              font=font_title,
              anchor="mm")
    y += int(50 * scale)

    # TOKEN NUMBER (big but not too tall)
    draw.text((width // 2, y),
              str(token_no),
              fill="black",
              font=font_big,
              anchor="mm")
    y += int(60 * scale)

    # TIME
    now = datetime.now().strftime("%d %b %Y | %I:%M %p")

    draw.text((width // 2, y),
              now,
              fill="black",
              font=font_time,
              anchor="mm",
              stroke_width=max(1, int(1 * scale)),
              stroke_fill="black")
    y += int(45 * scale)

    # ROOM INFO (compact)
    draw.text((width // 2, y),
              "Nursing: Room 7",
              fill="black",
              font=font_small,
              anchor="mm")
    y += int(30 * scale)

    draw.text((width // 2, y),
              "Lab: Room 8",
              fill="black",
              font=font_small,
              anchor="mm")
    y += int(35 * scale)

    # WIFI (split into short safe lines)
    draw.text((width // 2, y),
              "WiFi: PAD-Guest",
              fill="black",
              font=font_small,
              anchor="mm")
    y += int(25 * scale) 

    draw.text((width // 2, y),
              "Pass: pad@guest",
              fill="black",
              font=font_small,
              anchor="mm")

    return img


def print_token(printer_name: str, token_no: int, dept: str):
    # ---------- WINDOWS: silent direct print ----------
    if sys.platform.startswith("win"):
        try:
            import win32print
            import win32ui
            from PIL import ImageWin

            if not printer_name.strip():
                printer_name = win32print.GetDefaultPrinter()

            print(f"[PRINT] Using printer: {printer_name}")

            hDC = win32ui.CreateDC()
            hDC.CreatePrinterDC(printer_name)

            printable_w = hDC.GetDeviceCaps(8)   # HORZRES
            printable_h = hDC.GetDeviceCaps(10)  # VERTRES

            target_w = max(384, printable_w)
            target_h = int(target_w * (500 / 384))

            if target_h > printable_h and printable_h > 0:
                target_h = printable_h

            img = _generate_token_image(token_no, dept, target_w, target_h)

            hDC.StartDoc("PAD Token")
            hDC.StartPage()

            dib = ImageWin.Dib(img)
            dib.draw(hDC.GetHandleOutput(), (0, 0, target_w, target_h))

            hDC.EndPage()
            hDC.EndDoc()
            hDC.DeleteDC()
            return

        except Exception as e:
            print("PRINT ERROR (Windows):", e)

    # ---------- macOS: save + open print dialog ----------
    try:
        # Use temp folder so project stays clean
        out_dir = "/tmp"
        os.makedirs(out_dir, exist_ok=True)

        out_path = os.path.join(
            out_dir,
            f"token_{token_no}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
        )

        # Use your original 384x500 design (perfect for thermal)
        img = _generate_token_image(token_no, dept, 384, 500)
        img.save(out_path, "PNG")

        print(f"[PRINT] macOS print file generated: {out_path}")

        # Open print dialog (user selects printer)
        subprocess.run(["open", out_path], check=False)

    except Exception as e:
        print("PRINT ERROR (macOS):", e)
        try:
            img.save("print_failed.png")
        except Exception:
            pass
