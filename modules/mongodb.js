var _ = require('lodash');
var async = require('async-chainable');
var monoxide = require('monoxide');

module.exports = function(settings) {
	var driver = this;
	driver.store = {};

	driver.model;

	driver.canLoad = function(cb) {
		_.defaultsDeep(settings, {
			mongodb: {
				collection: 'mfdcCaches',
			},
		});

		async()
			// Sanity checks {{{
			.then(function(next) {
				if (!settings.mongodb.uri) return next('Missing setting: mongodb.uri');
				next();
			})
			// }}}
			// Connect {{{
			.then(function(next) {
				monoxide.connect(settings.mongodb.uri, next);
			})
			// }}}
			// Setup storage schema {{{
			.then(function(next) {
				driver.model = monoxide.schema(settings.mongodb.collection, {
					key: {type: 'string', index: {unique: true}},
					expiry: {type: 'date'},
					value: {type: 'mixed'},
				});
				next();
			})
			// }}}
			// End {{{
			.end(function(err) {
				if (err) return cb(err);
				cb(null, true);
			});
			// }}}
	};

	driver.set = function(key, value, expiry, cb) {
		driver.model.create({key, value, expiry}, function(err, res) {
			if (err && err.code && err.code == 11000) { // Dupe - clear and retry
				driver.unset(key, ()=> {
					driver.set(key, value, expiry, (err, res) => {
						if (err) return cb(err);
						cb(null, value);
					});
				});
			} else if (err) {
				return cb(err);
			} else {
				cb(null, value);
			}
		});
	};

	driver.get = function(key, fallback, cb) {
		driver.model.findOne({key, $errNotFound: false}, (err, val) => {
			if (!val) { // Not found
				cb(null, fallback || undefined);
			} else if (val.expiry && val.expiry < new Date()) { // Expired
				driver.unset(key, ()=> {
					cb(null, fallback);
				});
			} else { // Value ok
				cb(null, val.value);
			}
		});
	};

	driver.unset = function(key, cb) {
		driver.model.delete({key}, cb);
	};

	driver.vacuume = function(cb) {
		driver.model.delete({
			expiry: {$lt: new Date()},
		}, cb);
	};

	return driver;
};
