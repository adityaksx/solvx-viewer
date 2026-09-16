#!/usr/bin/env python3
"""Run SolvX backend + interactive frontend with one command."""
from pathlib import Path
import json
import threading
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT=Path(__file__).resolve().parent
FRONTEND=ROOT/'frontend'

def start_api():
    import uvicorn
    from backend.main import app
    uvicorn.run(app,host='127.0.0.1',port=8000,log_level='info')

def main():
    data_dir=ROOT/'data'
    FRONTEND.mkdir(parents=True,exist_ok=True)
    geom_file = FRONTEND / 'geometry.json'
    if not geom_file.exists():
        from data import prepare
        print('Preparing GEBCO/coast/EEZ geometry…')
        geometry=prepare(data_dir)
        geom_file.write_text(json.dumps(geometry,separators=(',',':')),encoding='utf-8')
    else:
        print('Using existing GEBCO/coast/EEZ geometry.json.')
    threading.Thread(target=start_api,daemon=True).start()
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(FRONTEND),**kwargs)
        def log_message(self,fmt,*args):print('[frontend]',fmt%args)
    server=ThreadingHTTPServer(('127.0.0.1',5500),Handler)
    url='http://127.0.0.1:5500/'
    print(f'SolvX: {url}')
    print('API: http://127.0.0.1:8000/docs')
    def safe_open():
        try:webbrowser.open(url)
        except Exception:pass
    threading.Timer(1.2,safe_open).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
