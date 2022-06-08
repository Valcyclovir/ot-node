const { execSync } = require('child_process');
const DeepExtend = require('deep-extend');
const rc = require('rc');
const fs = require('fs');
const queue = require('fastq');
const appRootPath = require('app-root-path');
const path = require('path');
const DependencyInjection = require('./modules/service/dependency-injection');
const Logger = require('./modules/logger/logger');
const constants = require('./modules/constants');
const pjson = require('./package.json');
const configjson = require('./config/config.json');
const M1FolderStructureInitialMigration = require('./modules/migration/m1-folder-structure-initial-migration');
const FileService = require('./modules/service/file-service');

class OTNode {
    constructor(config) {
        this.initializeConfiguration(config);
        this.logger = new Logger(this.config.logLevel, this.config.telemetryHub.enabled);
    }

    async start() {
        await this.runFolderStructureInitialMigration();

        this.logger.info(' ██████╗ ████████╗███╗   ██╗ ██████╗ ██████╗ ███████╗');
        this.logger.info('██╔═══██╗╚══██╔══╝████╗  ██║██╔═══██╗██╔══██╗██╔════╝');
        this.logger.info('██║   ██║   ██║   ██╔██╗ ██║██║   ██║██║  ██║█████╗');
        this.logger.info('██║   ██║   ██║   ██║╚██╗██║██║   ██║██║  ██║██╔══╝');
        this.logger.info('╚██████╔╝   ██║   ██║ ╚████║╚██████╔╝██████╔╝███████╗');
        this.logger.info(' ╚═════╝    ╚═╝   ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝');

        this.logger.info('======================================================');
        this.logger.info(`             OriginTrail Node v${pjson.version}`);
        this.logger.info('======================================================');
        this.logger.info(`Node is running in ${process.env.NODE_ENV} environment`);

        this.initializeDependencyContainer();
        await this.initializeModules();
        await this.saveNetworkModulePeerIdAndPrivKey();
        await this.initializeDataModule();
        await this.initializeOperationalDbModule();
        await this.initializeCommandExecutor();
        await this.initializeTelemetryHubModule();
        await this.initializeRpcModule();
        // await this.initializeWatchdog();
    }

    async runFolderStructureInitialMigration() {
        const m1FolderStructureInitialMigration = new M1FolderStructureInitialMigration(
            this.logger,
            this.config,
        );
        return m1FolderStructureInitialMigration.run();
    }

    initializeConfiguration(userConfig) {
        const defaultConfig = JSON.parse(JSON.stringify(configjson[process.env.NODE_ENV]));

        if (userConfig) {
            this.config = DeepExtend(defaultConfig, userConfig);
        } else {
            this.config = rc(pjson.name, defaultConfig);
        }
        if (!this.config.configFilename) {
            // set default user configuration filename
            this.config.configFilename = '.origintrail_noderc';
        }
        const blockchainModuleConfig = this.config.modules.blockchain.implementation['web3-service'].config;
        if (
            !blockchainModuleConfig.hubContractAddress &&
            blockchainModuleConfig.networkId ===
                defaultConfig.modules.blockchain.implementation['web3-service'].config.networkId
        ) {
            blockchainModuleConfig.hubContractAddress =
                configjson[process.env.NODE_ENV].modules.blockchain.implementation[
                    'web3-service'
                ].config.hubContractAddress;
        }

        const fileService = new FileService({ config: this.config });

        const updateFilePath = fileService.getUpdateFilePath();
        if (fs.existsSync(updateFilePath)) {
            this.config.otNodeUpdated = true;
            fileService.removeFile(updateFilePath).catch((error) => {
                this.logger.warn(`Unable to remove update file. Error: ${error}`);
            });
        }
    }

    initializeDependencyContainer() {
        this.container = DependencyInjection.initialize();
        DependencyInjection.registerValue(this.container, 'config', this.config);
        DependencyInjection.registerValue(this.container, 'logger', this.logger);
        DependencyInjection.registerValue(this.container, 'constants', constants);
        DependencyInjection.registerValue(this.container, 'blockchainQueue', queue);
        DependencyInjection.registerValue(this.container, 'tripleStoreQueue', queue);

        this.logger.info('Dependency injection module is initialized');
    }

    async initializeModules() {
        const initializationPromises = [];
        for (const moduleName in this.config.modules) {
            const moduleManagerName = `${moduleName}ModuleManager`;

            const moduleManager = this.container.resolve(moduleManagerName);
            initializationPromises.push(moduleManager.initialize());
        }
        try {
            await Promise.all(initializationPromises);
            this.logger.info(`All modules initialized!`);
        } catch (e) {
            this.logger.error({
                msg: `Module initialization failed. Error message: ${e.message}`,
                Event_name: constants.ERROR_TYPE.MODULE_INITIALIZATION_ERROR,
            });
            process.exit(1);
        }
    }

    async initializeDataModule() {
        try {
            const dataService = this.container.resolve('dataService');
            await dataService.initialize();
            this.logger.info(`Data module: ${dataService.getName()} implementation`);
        } catch (e) {
            this.logger.error({
                msg: `Data module initialization failed. Error message: ${e.message}`,
                Event_name: constants.ERROR_TYPE.DATA_MODULE_INITIALIZATION_ERROR,
            });
        }
    }

    async initializeOperationalDbModule() {
        try {
            this.logger.info('Operational database module: sequelize implementation');
            // eslint-disable-next-line global-require
            const db = require('./models');

            if (this.config.otNodeUpdated) {
                execSync(`npx sequelize --config=./config/sequelizeConfig.js db:migrate`);
            }

            await db.sequelize.sync();
        } catch (e) {
            this.logger.error({
                msg: `Operational database module initialization failed. Error message: ${e.message}`,
                Event_name: constants.ERROR_TYPE.OPERATIONALDB_MODULE_INITIALIZATION_ERROR,
            });
        }
    }

    async saveNetworkModulePeerIdAndPrivKey() {
        const networkModuleManager = this.container.resolve('networkModuleManager');
        const peerId = networkModuleManager.getPeerId();
        const privateKey = networkModuleManager.getPrivateKey();

        this.config.network.peerId = peerId;
        if (!this.config.network.privateKey && this.config.network.privateKey !== privateKey) {
            this.config.network.privateKey = privateKey;
            if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
                this.savePrivateKeyInUserConfigurationFile(privateKey);
            }
        }
    }

    async initializeCommandExecutor() {
        try {
            const commandExecutor = this.container.resolve('commandExecutor');
            await commandExecutor.init();
            commandExecutor.replay();
            await commandExecutor.start();
        } catch (e) {
            this.logger.error({
                msg: `Command executor initialization failed. Error message: ${e.message}`,
                Event_name: constants.ERROR_TYPE.COMMAND_EXECUTOR_INITIALIZATION_ERROR,
            });
        }
    }

    async initializeRpcModule() {
        try {
            const rpcController = this.container.resolve('rpcController');
            await rpcController.initialize();
        } catch (e) {
            this.logger.error({
                msg: `RPC service initialization failed. Error message: ${e.message}`,
                Event_name: constants.ERROR_TYPE.RPC_INITIALIZATION_ERROR,
            });
        }
    }

    async initializeTelemetryHubModule() {
        try {
            const telemetryHubModuleManager = this.container.resolve('telemetryHubModuleManager');
            if (telemetryHubModuleManager.initialize(this.config.telemetryHub, this.logger)) {
                this.logger.info(
                    `Telemetry hub module initialized successfully, using ${telemetryHubModuleManager.config.telemetryHub.packages} package(s)`,
                );
            }
        } catch (e) {
            this.logger.error(
                `Telemetry hub module initialization failed. Error message: ${e.message}`,
            );
        }
    }

    async initializeWatchdog() {
        try {
            const watchdogService = this.container.resolve('watchdogService');
            await watchdogService.initialize();
            this.logger.info('Watchdog service initialized');
        } catch (e) {
            this.logger.warn(`Watchdog service initialization failed. Error message: ${e.message}`);
        }
    }

    savePrivateKeyInUserConfigurationFile(privateKey) {
        const configurationFilePath = path.join(appRootPath.path, '..', this.config.configFilename);
        const configFile = JSON.parse(fs.readFileSync(configurationFilePath));
        configFile.network.privateKey = privateKey;
        fs.writeFileSync(configurationFilePath, JSON.stringify(configFile, null, 2));
    }

    stop() {
        this.logger.info('Stopping node...');
        process.exit(0);
    }
}

module.exports = OTNode;
