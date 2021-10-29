'use strict';

const fs = require( 'fs' ),
	path = require( 'path' ),
	configs = require( '../package' ).files,
	escapeStringRegexp = require( 'escape-string-regexp' );

function getRules( config ) {
	const rules = Object.assign( {}, config.rules );
	if ( config.overrides ) {
		config.overrides.forEach( ( override ) => {
			Object.assign( rules, override.rules );
		} );
	}
	return rules;
}

function getPluginExtends( config ) {
	let rules = {};
	let globals = {};
	const extendsList = Array.isArray( config.extends ) ?
		config.extends :
		[ config.extends ];
	// Fetch every upstream config we use via 'extends'.
	extendsList.forEach( ( extend ) => {
		const parts = extend.match( /plugin:(.*)\/([^/]+)/ );
		if ( !parts ) {
			return;
		}
		let upstreamConfigs;
		if ( parts[ 1 ].includes( 'eslint-plugin-' ) ) {
			upstreamConfigs = require( parts[ 1 ] ).configs;
		} else {
			upstreamConfigs = require( 'eslint-plugin-' + parts[ 1 ] ).configs;
		}
		const childConfig = upstreamConfigs[ parts[ 2 ] ];
		Object.assign(
			rules,
			getRules( childConfig )
		);
		Object.assign( globals, childConfig.globals );
		if ( childConfig.extends ) {
			const extendsConfig = getPluginExtends( childConfig );
			rules = Object.assign( {}, extendsConfig.rules, rules );
			globals = Object.assign( {}, extendsConfig.globals, globals );
		}
	} );
	return { rules, globals };
}

configs.forEach( ( configPath ) => {
	const configName = configPath.replace( /\..*/, '' );
	const fixturesDir = path.resolve( __dirname, `fixtures/${configName}` );
	const upstreamConfigsToTest = [
		'jquery',
		'jsdoc',
		'json',
		'mocha',
		'qunit',
		'selenium'
	];

	QUnit.module( `"${configName}" config`, () => {
		if ( !fs.existsSync( fixturesDir ) ) {
			QUnit.test.skip( `No tests for "${configName}" config` );
			return;
		}

		const config = require( `../${configPath}` );

		const fixturesFiles = fs.readdirSync( fixturesDir )
			.map( ( file ) => path.resolve( fixturesDir, file ) );

		const validFixturesFiles = fixturesFiles.filter( ( file ) => file.includes( '/valid' ) );
		const invalidFixturesFiles = fixturesFiles.filter( ( file ) => file.includes( '/invalid' ) );

		let rules = getRules( config );
		let globals = config.globals || {};

		if ( configName === 'server' ) {
			// Load the rules for Node & ES2018 when testing server
			Object.assign(
				rules,
				getRules( require( '../node' ) ),
				getRules( require( '../language/es2018' ) ),
				// TODO: Traverse "extends" automatically
				getRules( require( '../language/rules-es2018' ) ),
				getRules( require( '../language/rules-es2017' ) ),
				getRules( require( '../language/rules-es6' ) )
				// ES5 rules are tested in client-es5
			);
		}

		if ( upstreamConfigsToTest.includes( configName ) ) {
			const extendsConfig = getPluginExtends( config );
			rules = Object.assign( {}, extendsConfig.rules, rules );
			globals = Object.assign( {}, extendsConfig.globals, globals );
		}

		function isEnabled( rule ) {
			return rules[ rule ] !== 'off';
		}

		// Invalid examples are required for every rule that is enabled,
		// as reportUnusedDisableDirectives ensures the disable directives
		// are actually being used.
		const invalidFixtures = invalidFixturesFiles.map( ( file ) =>
			fs.readFileSync( file ).toString()
		).join( '' );

		Object.keys( rules ).forEach( ( rule ) => {
			// Disabled rules are covered below
			if ( isEnabled( rule ) ) {
				QUnit.test( `Rule '${rule}' is covered in invalid fixture`, ( assert ) => {
					const rDisableRule = new RegExp( `(/[/*]|<!--) eslint-disable((-next)?-line)? ([a-z-/]+, )*?${rule}($|[^a-z-])` );
					assert.true( rDisableRule.test( invalidFixtures ), 'eslint-disable comment found' );
				} );
			}
		} );

		const validFixtures = validFixturesFiles.map( ( file ) =>
			fs.readFileSync( file ).toString()
		).join( '' );

		Object.keys( rules ).forEach( ( rule ) => {
			const rEnableRule = new RegExp( `Off: ${rule}($|[^a-z-])` );
			if ( !isEnabled( rule ) ) {
				QUnit.test( `Rule '${rule}' is covered as "off" in valid fixture`, ( assert ) => {
					assert.true( rEnableRule.test( validFixtures ), '"Off" comment found' );
				} );
			} else {
				QUnit.test( `Rule '${rule}' is not covered as "off" in valid fixture`, ( assert ) => {
					assert.true( !rEnableRule.test( validFixtures ), '"Off" comment not present' );
				} );
			}
		} );

		Object.keys( globals ).forEach( ( global ) => {
			const rGlobal = new RegExp( `Global: ${escapeStringRegexp( global )}(\n|$)` );
			if ( globals[ global ] !== 'off' ) {
				QUnit.test( `Global '${global}' is documented in valid fixture`, ( assert ) => {
					assert.true( rGlobal.test( validFixtures ), '"Global" comment found' );
				} );
			} else {
				QUnit.test( `Disabled global '${global}' is documented in invalid fixture`, ( assert ) => {
					assert.true( rGlobal.test( invalidFixtures ), '"Global" comment found' );
				} );
			}
		} );
	} );
} );
