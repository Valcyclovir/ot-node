import publishSchema from '../controllers/http-api/request-schema/publish-schema.js';
import getSchema from '../controllers/http-api/request-schema/get-schema.js';
import searchSchema from '../controllers/http-api/request-schema/search-schema.js';
import querySchema from '../controllers/http-api/request-schema/query-schema.js';
import bidSuggestionSchema from '../controllers/http-api/request-schema/bid-suggestion-schema.js';

class JsonSchemaService {
    constructor(ctx) {
        this.blockchainModuleManager = ctx.blockchainModuleManager;
    }

    bidSuggestionSchema() {
        return bidSuggestionSchema(this.blockchainModuleManager.getImplementationNames());
    }

    publishSchema() {
        return publishSchema(this.blockchainModuleManager.getImplementationNames());
    }

    getSchema() {
        return getSchema();
    }

    searchSchema() {
        return searchSchema();
    }

    querySchema() {
        return querySchema();
    }
}

export default JsonSchemaService;
