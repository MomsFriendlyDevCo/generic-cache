import _ from 'lodash';
import redis from 'redis';

export default function(settings, cache) {
	let driver = {};

	driver.settings = _.defaultsDeep(settings, {
		redis: {
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
			retry_strategy: ()=> undefined, // Stop after first try
		},
	});

	driver.canLoad = ()=> new Promise(resolve =>
		driver.client = redis.createClient(driver.settings.redis)
			.on('error', ()=> resolve(false))
			.on('ready', ()=> resolve(true))
	);

	driver.set = (key, val, expiry) => new Promise((resolve, reject) => {
		if (!expiry) {
			driver.client.set(key, driver.settings.redis.serialize(val), err => err ? reject(err) : resolve(val));
		} else {
			driver.client.set(
				key,
				driver.settings.redis.serialize(val),
				'PX', // Prefix that next command is the timeout in MS
				Math.floor(expiry ? expiry - Date.now() : driver.settings.memcached.lifetime), // Timeout in MS
				err => err ? reject(err) : resolve(val)
			);
		}
	});

	driver.get = (key, fallback) => new Promise((resolve, reject) => {
		driver.client.get(key, (err, val) => {
			if (err) return reject(err);
			val = val ? driver.settings.redis.deserialize(val) : undefined;
			resolve(val !== undefined ? val : fallback);
		});
	});

	driver.size = key => new Promise((resolve, reject) => {
		driver.client.strlen(key, (err, val) => {
			if (err) return reject(err);
			resolve(val);
		});
	});

	driver.unset = key => new Promise((resolve, reject) => {
		driver.client.del(key, err => err ? reject(err) : resolve());
	});

	driver.list = ()=> new Promise((resolve, reject) => {
		let glob = driver.utilRegExpToGlob(driver.settings.keyQuery());
		if (glob == '.') glob = '*'; // Convert single char (anything) matches to glob all

		driver.client.keys(glob, (err, list) => {
			if (err) return reject(err);

			resolve(list.map(doc => ({
				id: doc,
			})));
		});
	});

	driver.has = key => new Promise((resolve, reject) => {
		driver.client.keys(key, (err, list) => {
			if (err) return reject(err);
			resolve(list.length > 0);
		});
	});

	driver.destroy = ()=> new Promise((resolve, reject) => {
		driver.client.quit(err => err ? reject(err) : resolve());
	});

	/**
	* Utility function to convert a RegExp to a Redis glob query
	* @param {RegExp} re Regular expression to convert
	* @returns {string} A (basic) Redis glob
	*/
	driver.utilRegExpToGlob = re =>
		re
			.toString()
			.replace(/^\/(.*)\/$/, '$1') // Remove prefix / suffix braces
			.replace(/\?/g, '.')
			.replace(/\.\*/g, '*')
			.replace(/\.\+/g, '*');

	return driver;
}
