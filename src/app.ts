import IdentityProvider from "orbit-db-identity-provider";
import { randomPortsConfigAsync } from "explorer-core/src/ipfs/ipfsDefaultConfig";
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
import InputsOutputs from "explorer-core/src/models/InputsOutputs";

const blockbook = new Blockbook({
    nodes: ["btc1.trezor.io", "btc2.trezor.io"],
});

const dbName = process.env.DB_NAME;
const chunkSize = parseInt(process.env.CHUNK_SIZE) || 10;

const MAX_BLOCK_HEIGHT =
    parseInt(process.env.MAX_BLOCK_HEIGHT) || Infinity;

console.log({
    dbName,
    MAX_BLOCK_HEIGHT,
});

export async function start() {
    IPFSconnector.setConfig(await randomPortsConfigAsync());
    const id = (
        await (await IPFSconnector.getInstanceAsync()).node.id()
    ).id;
    const identity = await IdentityProvider.createIdentity({
        id,
    });
    Database.connect(dbName, identity);
    await Database.use(dbName).execute(
        async (database: DatabaseInstance) => {
            Database.selectedDatabase.getOrCreateTableByEntity(
                new InputsOutputs(),
            );
            Database.selectedDatabase.getOrCreateTableByEntity(
                new Transaction(),
            );
            Database.selectedDatabase.getOrCreateTableByEntity(
                new Block(),
            );

            let blockHeight = 0;
            let tasks: Promise<void>[] = [];
            while (blockHeight <= MAX_BLOCK_HEIGHT) {
                const block = ((await blockbook.getBlock(
                    blockHeight,
                )) as unknown) as BlockbookBlock;

                for (const tx of block.txs) {
                    tasks.push(Transaction.fromBlockbook(tx).save());
                }

                tasks.push(Block.fromBlockbook(block).save());
                blockHeight++;

                if (tasks.length >= chunkSize) {
                    await Promise.all(tasks);
                    tasks = [];
                    console.log("finished chunk");
                }
            }

            while (true) {
                await database.pubSubListener.publish(
                    new PubSubMessage({
                        type: PubSubMessageType.PublishVersion,
                        value: (
                            await database.log.toMultihash()
                        ).toString(),
                    }),
                );
                await delay(2000);
            }
        },
    );
}
