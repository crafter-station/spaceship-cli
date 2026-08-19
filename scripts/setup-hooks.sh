#!/bin/sh
# Installs the pre-push hook by symlink, so edits to the tracked script take
# effect without reinstalling.
set -e
root=$(git rev-parse --show-toplevel)
ln -sf ../../scripts/pre-push "$root/.git/hooks/pre-push"
echo "pre-push hook installed"
