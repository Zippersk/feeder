docker build -t feeder . && docker run -d feeder --network host --name feeder -v  /data/DP/feeder/data:/usr/src/app