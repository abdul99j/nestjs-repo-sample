import { DataSource } from 'typeorm';

export class AppDataSource {
	static dataSource: DataSource;
	static setDataSource(source: DataSource): undefined {
		AppDataSource.dataSource = source;
		return;
	}
}
