FROM mesoscloud/zookeeper:3.4.6-ubuntu

MAINTAINER ContainerShip Developers <developers@containership.io>

# reset entrypoint
ENTRYPOINT []

# install dependencies
RUN apt-get update && apt-get install curl npm -y

# install node
RUN npm install -g n
RUN n 0.10.38

# create /app and add files
WORKDIR /app
ADD . /app

# install dependencies
RUN npm install

# set default volume
VOLUME /tmp/zookeeper

# expose ports
EXPOSE 2181 2888 3888

# Execute the run script
CMD node zookeeper.js
