#!/bin/bash
# Pack project files changed since the last sync into /mnt/user-data/outputs/sync/delta.tgz (split if large)
cd /home/claude/ue
M=/home/claude/tools/.last_sync
[ -f $M ] || touch -d '2000-01-01' $M
rm -rf /mnt/user-data/outputs/sync; mkdir -p /mnt/user-data/outputs/sync
find Snowfall -type f -newer $M ! -path '*/Saved/*' ! -path '*/Intermediate/*' ! -name '*.pyc' > /tmp/delta.lst
echo "files: $(wc -l < /tmp/delta.lst)"; head -30 /tmp/delta.lst
tar -czf /tmp/delta.tgz -T /tmp/delta.lst
split -b 9500000 -d -a 2 /tmp/delta.tgz /mnt/user-data/outputs/sync/d.p
ls /mnt/user-data/outputs/sync
touch $M
