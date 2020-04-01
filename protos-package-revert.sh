#!/usr/bin/env bash
sed -i -e 's/package bcsdk.*$/package bc;/g' ./protos/*.proto
