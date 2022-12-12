import { TypeOrmExModule } from "./database/typeorm-ex.module";
import { TestReposity } from "./test.repositiry";

@Module({
    import: [TypeOrmExModule.forCustomRepository([TestReposity])],
})