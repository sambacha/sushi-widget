#!/bin/bash
source .env.production
export a=http://localhost:3501/script.js
export b=$JS_HOST/script.js
sed -i '' -- "s#$a#$b#g" dist/index.html
