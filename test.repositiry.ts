import { CustomRepository } from "./database/typeorm-ex.decorator";


@CustomRepository(/*Entity Name*/)
export class TestReposity extends Repository</*Entity*/>{

}