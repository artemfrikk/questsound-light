#!/bin/sh
# QuestSound Light for Linux: run from any folder, extra options go through (e.g. ./start.sh --pair)
cd "$(dirname "$0")" && exec ./node/bin/node questsound-light.mjs "$@"
