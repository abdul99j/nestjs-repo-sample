import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { RemoveOptions } from 'typeorm/repository/RemoveOptions';
import { SaveOptions } from 'typeorm/repository/SaveOptions';
import { OrmUtils } from 'typeorm/util/OrmUtils';
import { ObjectState } from '../common/enums';
import { AppDataSource } from '../database/data-source';
import { EntityBase } from './entitybase';

export interface IRawQuery {
	query: string;
	parameters: (object | string | unknown)[];
}

export enum HookType {
	AfterCommit = 'AFTER_COMMIT',
}

export interface RegisterHooksProps {
	// eslint-disable-next-line @typescript-eslint/ban-types
	listener: Function;
	data: {
		[key: string]: object | string;
	};
}

interface HooksMetaData extends RegisterHooksProps {
	type: HookType;
}

export enum TransactionCollectionEnum {
	RawQuery = 'RAW_QUERY',
	EntityCollection = 'ENTITY_COLLECTION',
	BulkEntityCollnection = 'BULK_ENTITY_COLLECTION',
}

export class TransactionScopeOptions {
	where?: string;
	values: QueryDeepPartialEntity<EntityBase>;
}

export class TransactionScopeObject {
	type: TransactionCollectionEnum;
	object: EntityBase[] | EntityBase | IRawQuery;
	objectState?: ObjectState;
	options?: TransactionScopeOptions;
}

export class TransactionScope {
	private _transactionObjects: TransactionScopeObject[] = [];
	private _hooks: HooksMetaData[] = [];
	private appDataSource: DataSource;

	constructor() {
		this.appDataSource = AppDataSource.dataSource;
	}

	get transactionObjects(): TransactionScopeObject[] {
		return this._transactionObjects;
	}

	public addRawQuery(query: string, parameters: (object | string)[]): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.RawQuery,
			object: { query: query, parameters: parameters },
		});
	}

	// future improvment:
	// public rawSqlResultsToEntityTransformer(rawResults: any[], alias: Alias): any[] {
	// const transformer = new RawSqlResultsToEntityTransformer();
	//   return transformer.transform(rawResults, alias);
	// }

	private resetTransactionObjects(): void {
		this._transactionObjects = [];
	}

	public add(obj: EntityBase): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.Insert,
		});
	}

	public addCollection(collection: EntityBase[]): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.BulkEntityCollnection,
			object: collection,
			objectState: ObjectState.Insert,
		});
	}

	public update(obj: EntityBase): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.Update,
		});
	}

	private registerHook(props: HooksMetaData): void {
		this._hooks.push(props);
	}

	private filterHooks(type: HookType): HooksMetaData[] {
		return this._hooks.filter((hook) => hook.type === type);
	}

	private excludeHooks(type: HookType): HooksMetaData[] {
		return this._hooks.filter((hook) => hook.type !== type);
	}

	/**
	 * Register the listener function as AfterCommit Hooks. It will be invoked after the changes are committed to db.
	 * Invoked function will received data object as argument. It is recommended to use arrow functions.
	 *
	 * @param listener Function to be called after changes are committed to db.
	 * @param data data object that will passed as argument when Hook is invoked.
	 * @return
	 * @example
	 *
	 * transactionScope.registerAfterCommit({
	 *   listener: (data) => {
	 *     console.log(data.name);
	 *   },
	 *   data: {
	 *     name: "Roronoa Zoro",
	 *   },
	 * });
	 */
	public registerAfterCommit(props: RegisterHooksProps): void {
		this.registerHook({
			...props,
			type: HookType.AfterCommit,
		});
	}

	/**
	 * Clear all register AfterCommits Hooks.
	 */
	public resetAfterCommit(): void {
		this._hooks = this.excludeHooks(HookType.AfterCommit);
	}

	// the custom values method don't escape values - would need to parametarize to avoid SQL injection

	public insertWithCustomValues(obj: EntityBase, options: TransactionScopeOptions): void {
		// this method does insert all values passed in options.values into the entity
		// except for the raw sql
		if (options.where) throw new BadRequestException(`can't pass criteria when inserting values`);

		for (const [key, value] of Object.entries(options.values)) {
			if (typeof value !== 'function') {
				obj[key] = value;
			}
		}

		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.Insert,
			options,
		});
	}

	public updateWithCustomValues(obj: EntityBase, options: TransactionScopeOptions): void {
		// this method does updates entity with all values passed in options.values
		// except for the raw sql
		for (const [key, value] of Object.entries(options.values)) {
			if (typeof value !== 'function') {
				obj[key] = value;
			}
		}

		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.Update,
			options,
		});
	}

	public updateCollection(collection: EntityBase[]): void {
		for (const col of collection) {
			if (col.entitySnapshot) {
				collection.forEach((obj) => this.update(obj));
				return;
			}
		}
		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: collection,
			objectState: ObjectState.Update,
		});
	}

	public delete(obj: EntityBase): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.Delete,
		});
	}

	public hardDelete(obj: EntityBase): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.EntityCollection,
			object: obj,
			objectState: ObjectState.HardDelete,
		});
	}

	public deleteCollection(collection: EntityBase[]): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.BulkEntityCollnection,
			object: collection,
			objectState: ObjectState.Delete,
		});
	}

	public hardDeleteCollection(collection: EntityBase[]): void {
		this._transactionObjects.push({
			type: TransactionCollectionEnum.BulkEntityCollnection,
			object: collection,
			objectState: ObjectState.HardDelete,
		});
	}

	private async processAfterCommitHooks(): Promise<void> {
		try {
			const afterCommitsHooks = this.filterHooks(HookType.AfterCommit);
			const promises = afterCommitsHooks.map((hook) => hook.listener(hook.data));
			await Promise.allSettled(promises);
		} catch (error) {
			console.error('error while executing transaction scope AfterCommit Hooks', error);
			throw error;
		} finally {
			this.resetAfterCommit();
		}
	}

	private extractCollectionsFromTransactions(
		transactionObjects: TransactionScopeObject[],
	): [(TransactionScopeObject | EntityBase)[], IRawQuery[]] {
		const entityCollection: (TransactionScopeObject | EntityBase)[] = [];
		const rawQueryCollection: IRawQuery[] = [];

		transactionObjects.forEach((trObj) => {
			if (trObj.type === TransactionCollectionEnum.EntityCollection) {
				entityCollection.push(trObj);
			} else if (trObj.type === TransactionCollectionEnum.BulkEntityCollnection) {
				const obj = trObj.object as EntityBase[];
				entityCollection.push(...obj);
			} else {
				rawQueryCollection.push(trObj as unknown as IRawQuery);
			}
		});

		return [entityCollection, rawQueryCollection];
	}

	public async commit(
		saveOptions?: SaveOptions,
		removeOptions?: RemoveOptions,
		performEntityBulkUpsert = false,
	): Promise<void> {
		try {
			await this.appDataSource.manager.transaction(async (transactionEntityManager) => {
				if (performEntityBulkUpsert) {
					const [entityCollection, rawQueryCollection] = this.extractCollectionsFromTransactions(
						this.transactionObjects,
					);

					await transactionEntityManager.save(entityCollection, saveOptions);
					if (rawQueryCollection.length > 0) {
						for (const rawquery of rawQueryCollection) {
							await transactionEntityManager.query(rawquery.query, rawquery.parameters);
						}
					}
				} else {
					for (const transaction of this.transactionObjects) {
						if (transaction.type === TransactionCollectionEnum.RawQuery) {
							const rawquery = transaction.object as IRawQuery;
							await transactionEntityManager.query(rawquery.query, rawquery.parameters);
						} else if (
							transaction.type === TransactionCollectionEnum.EntityCollection ||
							transaction.type === TransactionCollectionEnum.BulkEntityCollnection
						) {
							let entity: EntityBase | EntityBase[] | IRawQuery;
							switch (transaction.objectState) {
								case ObjectState.Delete:
									entity = transaction.object as EntityBase | EntityBase[];
									await transactionEntityManager.softRemove(entity, saveOptions);
									break;
								case ObjectState.HardDelete:
									entity = transaction.object as EntityBase | EntityBase[];
									await transactionEntityManager.remove(entity, saveOptions);
									break;
								case ObjectState.Update:
									entity = transaction.object;
									if (entity instanceof EntityBase) {
										if (entity.entitySnapshot) {
											const entityClass = entity.constructor.name;
											// commented because of implicity any type
											// entity['__proto__']['constructor']['name'];
											const propertiesToUpdate = entity.getPropertiesToUpdate;
											await transactionEntityManager.update(
												entityClass,
												{ id: entity.id },
												propertiesToUpdate,
											);
										} else if (transaction.options) {
											const criteria = transaction.options.where
												? transaction.options.where
												: { id: entity.id };
											const entityClass = entity.constructor.name;
											// Commented because of implicity any type
											// entity['__proto__']['constructor']['name'];
											await transactionEntityManager.update(
												entityClass,
												criteria,
												transaction.options.values,
											);
										} else {
											await transactionEntityManager.save(entity, saveOptions);
										}
									} else if (Array.isArray(entity)) {
										await transactionEntityManager.save(entity, saveOptions);
									} else {
										console.error('ENTITY NOT AN INSTANCE OF ENTITY BASE', entity);
										throw new Error('Entity is not an instance of entity base');
									}
									break;
								case ObjectState.Insert:
									if (transaction.options) {
										entity = transaction.object;
										const entityClass = entity.constructor.name;
										// commented because of implicit any type
										// entity['__proto__']['constructor']['name'];
										const insertResult = (
											await transactionEntityManager.insert(entityClass, transaction.options.values)
										).generatedMaps[0];
										// deep merge insert result in transaction.object
										OrmUtils.mergeDeep(transaction.object, insertResult);
									} else {
										entity = transaction.object as EntityBase | EntityBase[];
										await transactionEntityManager.save(entity, saveOptions);
										break;
									}
							}
						}
					}
				}
			});
			this.resetTransactionObjects();
		} catch (error) {
			this.resetTransactionObjects();
			throw error;
		}
		// process AfterCommits Hooks
		await this.processAfterCommitHooks();
	}
}
