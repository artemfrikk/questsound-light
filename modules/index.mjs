// Every module the bridge knows. A new brand is one more file with the same shape (see README → Writing a module).
import homeassistant from './homeassistant.mjs';
import yeelight from './yeelight.mjs';
import yandex from './yandex.mjs';
import mqtt from './mqtt.mjs';
import wled from './wled.mjs';
import webhook from './webhook.mjs';

export const MODULES = [homeassistant, yeelight, yandex, mqtt, wled, webhook];
