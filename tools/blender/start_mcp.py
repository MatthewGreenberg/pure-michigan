import bpy
import sys
import importlib.util

ADDON = "/Users/mattgreenberg/dev/demos/grass/tools/blender/addon.py"

spec = importlib.util.spec_from_file_location("blendermcp_addon", ADDON)
mod = importlib.util.module_from_spec(spec)
sys.modules["blendermcp_addon"] = mod
spec.loader.exec_module(mod)

try:
    mod.register()
except Exception as e:
    print("register() failed (may be partial):", e)


def _start():
    try:
        if getattr(bpy.types, "blendermcp_server", None) and bpy.types.blendermcp_server.running:
            print("BlenderMCP already running")
            return None
        bpy.types.blendermcp_server = mod.BlenderMCPServer(port=9876)
        bpy.types.blendermcp_server.start()
        try:
            bpy.context.scene.blendermcp_server_running = True
        except Exception:
            pass
    except Exception as e:
        print("Failed to start BlenderMCP server:", e)
    return None


bpy.app.timers.register(_start, first_interval=1.0)
print("start_mcp.py loaded; server starting on port 9876")
