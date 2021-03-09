#!/bin/bash
if [ ! -f .yarn-cache.tgz ]; then
  echo "+ build: Init empty .yarn-cache.tgz"
  tar cvzf .yarn-cache.tgz --files-from /dev/null
fi
