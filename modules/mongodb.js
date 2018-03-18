var _ = require('lodash');
var async = require('async-chainable');
var mongoose = require('mongoose');

module.exports = function(settings) {
	var driver = this;
	driver.store = {};

	driver.schema;
	driver.model;

	driver.settings = _.defaults(settings, {
		mongodb: {
			uri: 'mongodb://localhost/mfdc-cache',
			collection: 'mfdcCaches',
		},
	});

	driver.canLoad = function(cb) {
		async()
			// Sanity checks {{{
			.then(function(next) {
				if (!settings.mongodb.uri) return next('Missing setting: mongodb.uri');
				next();
			})
			// }}}
			// Connect {{{
			.then(function(next) {
				mongoose.connect(settings.mongodb.uri, next);
			})
			// }}}
			// Setup storage schema {{{
			.then(function(next) {
				driver.schema = new mongoose.Schema({
					key: {type: mongoose.Schema.Types.String, index: {unique: true}},
					expiry: {type: mongoose.Schema.Types.Date},
					value: {type: mongoose.Schema.Types.Mixed},
				});
				driver.model = mongoose.model('routeCache', driver.schema);

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
		async()
			// Find existing document if it exists {{{
			.then('existing', function(next) {
				driver.model.findOne({key}, next);
			})
			// }}}
			// Update or create document {{{
			.then(function(next) {
				if (this.existing) {
					this.existing.save({value, $ignoreModified: true}, next);
				} else {
					driver.model.create({key, value, expiry}, next);
				}
			})
			// }}}
			.end(cb)

	};

	driver.get = function(key, fallback, cb) {
		driver.model.findOne({key}, (err, val) => {
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
		driver.model.deleteOne({key}, cb);
	};

	driver.vacuume = function(cb) {
		driver.model.deleteMany({
			expiry: {$lt: new Date()},
		}, cb);
	};

	return driver;
};
