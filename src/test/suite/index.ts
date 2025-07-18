import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export function run(): Promise<void> {
    console.debug('>>> Test runner started');
    
    // Create the mocha test with BDD interface
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 10000,
        reporter: 'spec',
        bail: true, // Stop on first failure
        require: ['mocha/register'] // Ensure Mocha globals are available
    });

    const testsRoot = path.resolve(__dirname, '..');
    console.debug('Tests root directory:', testsRoot);

    return new Promise((resolve, reject) => {
        // Look for .js files since we're running compiled tests
        glob('**/**.test.js', { cwd: testsRoot })
            .then(files => {
                console.debug('Found test files:', files);
                
                if (files.length === 0) {
                    return reject(new Error('No test files found'));
                }

                // Add files to the test suite
                files.forEach(f => {
                    const fullPath = path.resolve(testsRoot, f);
                    console.debug('Adding test file:', fullPath);
                    try {
                        // Add the file to Mocha directly
                        mocha.addFile(fullPath);
                        console.debug('Successfully added test file:', fullPath);
                    } catch (err) {
                        console.error('Error adding test file:', err);
                        reject(err);
                    }
                });

                try {
                    console.debug('Starting test execution...');
                    // Run the mocha test
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            console.error(`${failures} tests failed.`);
                            reject(new Error(`${failures} tests failed.`));
                        } else {
                            console.debug('All tests passed!');
                            resolve();
                        }
                    });
                } catch (err) {
                    console.error('Error running tests:', err);
                    reject(err);
                }
            })
            .catch(err => {
                console.error('Error finding test files:', err);
                reject(err);
            });
    });
}

// Only run if this file is being executed directly
if (require.main === module) {
    run();
} 