#!/bin/sh
# wrap index.html in the same skeleton the artifact host adds
cd /home/claude/snowfall
{ echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style></head><body>'; cat index.html; echo '</body></html>'; } > dev.html
