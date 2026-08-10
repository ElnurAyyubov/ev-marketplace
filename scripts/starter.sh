#!/usr/bin/env bash

docker start couchdb0 couchdb1 orderer.example.com   peer0.org1.example.com peer0.org2.example.com   ca_org1 ca_org2    ca_orderer
docker compose -f ../docker-compose.example.yml up --build
