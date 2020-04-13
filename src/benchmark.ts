import Queriable from "explorer-core/src/database/DAL/query/queriable";
import PrimaryKey from "explorer-core/src/database/DAL/decorators/primaryKey";
import Index from "explorer-core/src/database/DAL/decorators";
import IPFSconnector from "explorer-core/src/ipfs/IPFSConnector";
import Database from "explorer-core/src/database/DAL/database/databaseStore";
import DatabaseInstance from "explorer-core/src/database/DAL/database/databaseInstance";
import IdentityProvider from "orbit-db-identity-provider";
import { TimeMeaseure } from "explorer-core/src/common";

class User extends Queriable<User> {
    @PrimaryKey()
    name: string;

    @Index()
    age: number;

    toString() {
        return this.age;
    }
}

(async () => {
    const id = (
        await (await IPFSconnector.getInstanceAsync()).node.id()
    ).id;
    const identity = await IdentityProvider.createIdentity({
        id,
    });
    Database.connect("testDB", identity);
    await Database.use("testDB").execute(
        async (db1: DatabaseInstance) => {
            Database.selectedDatabase.getOrCreateTableByEntity(
                new User(),
            );
            let tasks = [];
            const tm = TimeMeaseure.start("whole");
            let tmChunk = TimeMeaseure.start("chunk");
            for (let i = 0; i < 1000; i++) {
                const u = new User();
                u.name = "test" + i;
                u.age = i;
                tasks.push(u.save());
                if (tasks.length === 1) {
                    await Promise.all(tasks);
                    tasks = [];
                    console.log("done " + i);
                    tmChunk.stop();
                    tmChunk = TimeMeaseure.start("chunk");
                }
            }

            await Promise.all(tasks);
            tmChunk.stop();
            tm.stop();
            await TimeMeaseure.print();
            const users = await Promise.all(await new User().all());
        },
    );
})();
