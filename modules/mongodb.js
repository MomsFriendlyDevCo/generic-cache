import _ from 'lodash';
import mongoose from 'mongoose';

export default function(settings, cache) {
	let driver = {};

	driver.schema;
	driver.model;

	driver.settings = _.defaultsDeep(settings, {
		mongodb: {
			uri: 'mongodb://localhost/mfdc-cache',
			options: {
				useNewUrlParser: true,
				useUnifiedTopology: true,
			},
			collection: 'mfdcCaches',
			serialize: cache.settings.serialize,
			deserialize: cache.settings.deserialize,
		},
	});

	driver.canLoad = ()=> {
		if (!settings.mongodb.uri) throw new Error('Missing setting: mongodb.uri');

		return mongoose.connect(settings.mongodb.uri, settings.mongodb.options)
			.then(()=> {
				// Setup storage schema
				driver.schema = new mongoose.Schema({
					key: {type: mongoose.Schema.Types.String, index: {unique: true}},
					expiry: {type: mongoose.Schema.Types.Date},
					created: {type: mongoose.Schema.Types.Date},
					value: {type: mongoose.Schema.Types.Mixed},
				});
				driver.model = mongoose.model(settings.mongodb.collection, driver.schema);
			})
			.then(()=> true)
	};

	driver.set = (key, value, expiry) =>
		driver.model.findOne({key})
			.then(existing => {
				if (existing) {
					return this.existing.save({value: settings.mongodb.serialize(value), $ignoreModified: true});
				} else {
					return driver.model.create({key, value: settings.mongodb.serialize(value), expiry, created: new Date()});
				}
			});

	driver.get = (key, fallback) =>
		driver.model.findOne({key})
			.lean()
			.then(doc => {
				if (!doc) { // Not found
					return fallback;
				} else if (doc.expiry && doc.expiry < new Date()) { // Expired
					return driver.unset(key).then(()=> fallback);
				} else { // Value ok
					return settings.mongodb.deserialize(doc.value);
				}
			});

	driver.unset = key => driver.model.deleteOne({key});

	driver.has = key =>
		driver.model.findOne({key})
			.select('_id')
			.lean()
			.then(doc => {
				if (!doc) { // Not found
					return false;
				} else if (doc.expiry && doc.expiry < new Date()) { // Expired
					return driver.unset(key)
						.then(()=> false);
				} else { // Value ok
					return true;
				}
			});

	driver.list = ()=>
		driver.model.find()
			.lean()
			.then(docs => docs.map(doc => ({
				id: doc.key,
				created: doc.created,
				expiry: doc.expiry,
			})));

	driver.clean = ()=>
		driver.model.deleteMany({
			expiry: {$lt: new Date()},
		});

	driver.destroy = ()=> mongoose.connection.close();

	return driver;
}
