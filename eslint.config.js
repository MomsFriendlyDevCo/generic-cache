import RulesMFDC from '@momsfriendlydevco/eslint-config';

export default [
	{
		// Global ignore rules - Do not add any other keys to this object
		ignores: [
			'.*',
			'docs/',
			'dist/',
			'node_modules/',
			'public/docs/',
			'scripts/**/*',
			'**/.wrangler/',
		],
	},
	...RulesMFDC,
]
