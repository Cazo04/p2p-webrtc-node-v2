import * as path from 'path';
import SettingUtils from './src/utils/setting';
import SocketController from './src/controllers/socket';
import SystemUtils from './src/utils/system';

if (!SettingUtils.checkSettingsFileExists()) {
    console.error('Settings file not found!');
    console.error('Please configure the paths in your settings file before running the application.');
    process.exit(1);
} 
SettingUtils.loadSettings().then(() => {
    console.log('Settings loaded successfully.');

    const socketController = new SocketController();
    socketController.createConnection();   
}).catch(error => {
    console.error(error);
    process.exit(1);
});

