import ProtocolInitCommand from '../../../common/protocol-init-command.js';
import { ERROR_TYPE } from '../../../../../constants/constants.js';

class GetInitCommand extends ProtocolInitCommand {
    constructor(ctx) {
        super(ctx);
        this.operationService = ctx.getService;

        this.errorType = ERROR_TYPE.GET.GET_INIT_ERROR;
    }

    async prepareMessage(command) {
        return { assertionId: command.data.assertionId };
    }

    /**
     * Builds default getInitCommand
     * @param map
     * @returns {{add, data: *, delay: *, deadline: *}}
     */
    default(map) {
        const command = {
            name: 'v1_0_0GetInitCommand',
            delay: 0,
            retries: 0,
            transactional: false,
        };
        Object.assign(command, map);
        return command;
    }
}

export default GetInitCommand;
