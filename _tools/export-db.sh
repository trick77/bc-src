#!/usr/bin/env bash
set -e
timestamp=`date +%Y-%m-%d_%H-%M-%S`
export_dir="./export"
if [ -d "${export_dir}" ]; then rm -rf ${export_dir}; fi
echo "Exporting db data from container to host..."
docker cp bcnode:/bc/_data ${export_dir}
echo "Compressing db data..."
rm ./${export_dir}/db/IDENTITY
tar -zcf bcnode-db-${timestamp}.tar.gz -C ./${export_dir} .
echo "Done."
if [ -d "${export_dir}" ]; then rm -rf ${export_dir}; fi
