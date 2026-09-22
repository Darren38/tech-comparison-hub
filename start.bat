@echo off
rem Double-click to build the data and open the Technology Comparison Hub in your browser.
cd /d "%~dp0"
python serve.py --open
if errorlevel 1 pause
