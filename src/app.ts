import IdentityProvider from "orbit-db-identity-provider";
import logger from "explorer-core/src/logger";
import Transaction from "explorer-core/src/models/Transaction";
import Block from "explorer-core/src/models/Block";
import DatabaseInstance from "explorer-core/src/database/DAL/database/databaseInstance";
import PubSubMessage from "explorer-core/src/database/DAL/database/PubSub/pubSubMessage";
import { PubSubMessageType } from "explorer-core/src/database/DAL/database/PubSub/MessageType";
import { delay } from "explorer-core/src/common";
import IPFSconnector from "explorer-core/src/ipfs/IPFSConnector";
import Database from "explorer-core/src/database/DAL/database/databaseStore";
import { Blockbook } from "blockbook-client";
import Protector from "libp2p-pnet";
import storage from "node-persist";

const blockbook = new Blockbook({
    nodes: process.env.SOURCES.split(","),
});

const dbName = process.env.DB_NAME;
const chunkSize = parseInt(process.env.CHUNK_SIZE) || 10;

const MAX_BLOCK_HEIGHT = parseInt(process.env.MAX_BLOCK_HEIGHT) || Infinity;

console.log({
    dbName,
    MAX_BLOCK_HEIGHT,
});

export async function start() {
    await storage.init();

    IPFSconnector.setConfig({
        repo: "feeder",
        config: {
            Addresses: {
                Swarm: [
                    "/ip4/0.0.0.0/tcp/" + process.env.tcpPort,
                    "/ip4/127.0.0.1/tcp/" + process.env.wsPort + "/ws",
                    "/dns4/kancel.mucka.sk/tcp/19091/ws/p2p-webrtc-star",
                    "/dns4/kancel.mucka.sk/tcp/19090/ws/p2p-websocket-star",
                ],
            },
        },
        libp2p: {
            modules: {
                connProtector: new Protector(`/key/swarm/psk/1.0.0/
/base16/
30734f1804abb36a803d0e9f1a31ffe5851b6df1445bf23f96fd3fe8fbc9e793`),
            },
            config: {
                pubsub: {
                    emitSelf: false,
                },
            },
        },
    });
    const id = (await (await IPFSconnector.getInstanceAsync()).node.id()).id;
    const identity = await IdentityProvider.createIdentity({
        id,
    });
    Database.connect(dbName, identity);

    await Database.use(dbName).execute(async (database: DatabaseInstance) => {
        let blockHeight = 0;
        Database.selectedDatabase.getOrCreateTableByEntity(new Transaction());
        Database.selectedDatabase.getOrCreateTableByEntity(new Block());

        const oldDBRoot = await storage.getItem("DBroot");
        if (oldDBRoot) {
            Database.selectedDatabase.fromMultihash(oldDBRoot);
            blockHeight = await storage.getItem("blockHeight");
        }

        let tasks: Promise<void>[] = [];
        while (blockHeight <= MAX_BLOCK_HEIGHT) {
            let block = null;
            let tryCount = 0;
            while (!block) {
                try {
                    block = ((await blockbook.getBlock(blockHeight)) as unknown) as BlockbookBlock;
                    tryCount = 0;
                } catch (e) {
                    tryCount++;
                    console.log("error while requesting block " + blockHeight + ", but i will try again!");
                    for (let i = 0; i < tryCount; i++) {
                        await database.pubSubListener.publish(
                            new PubSubMessage({
                                type: PubSubMessageType.PublishVersion,
                                value: (await database.log.toMultihash()).toString(),
                            }),
                        );
                        await delay(2000);
                    }
                }
            }
            if (block.txs) {
                for (const tx of block.txs) {
                    tasks.push(Transaction.fromBlockbook(tx).save());
                }
            }

            tasks.push(Block.fromBlockbook(block).save());
            blockHeight++;

            if (tasks.length >= chunkSize) {
                await Promise.all(tasks);
                tasks = [];
                await storage.setItem("DBroot", Database.selectedDatabase.dbHash.toString());
                await storage.setItem("blockHeight", blockHeight);
                console.log("finished chunk");
            }
        }

        while (true) {
            await database.pubSubListener.publish(
                new PubSubMessage({
                    type: PubSubMessageType.PublishVersion,
                    value: (await database.log.toMultihash()).toString(),
                }),
            );
            await delay(2000);
        }
    });
}
