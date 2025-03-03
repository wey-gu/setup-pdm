import * as os from 'node:os'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import process from 'node:process'
import * as core from '@actions/core'
import { exec } from '@actions/exec'
import { IS_WINDOWS } from 'setup-python/src/utils'
import semParse from 'semver/functions/parse'
import * as utils from './utils'
import { cacheDependencies } from './caches'

const INSTALL_SCRIPT_URL = 'https://pdm.fming.dev/install-pdm.py'
interface InstallOutput {
  pdm_version: string
  pdm_bin: string
  install_python_version: string
  install_location: string
}

function getPep582Path(installDir: string, pythonVersion: string): string {
  const parsedVersion = semParse(pythonVersion)!
  if (IS_WINDOWS)
    return path.resolve(installDir, 'Lib/site-packages/pdm/pep582')
  else
    return path.resolve(installDir, 'lib', `python${parsedVersion.major}.${parsedVersion.minor}`, 'site-packages/pdm/pep582')
}

async function run(): Promise<void> {
  const arch = core.getInput('architecture') || os.arch()
  const pdmVersion = core.getInput('version')
  const pythonVersion = utils.resolveVersionInput()[0] || '3.x'
  const updateEnvironment = core.getBooleanInput('update-python')
  const allowPythonPreReleases = core.getBooleanInput('allow-python-prereleases')
  const pypiMirror = core.getInput('pypi-mirror')
  const cmdArgs = ['-']

  if (core.getBooleanInput('prerelease'))
    cmdArgs.push('--prerelease')

  if (pdmVersion)
    cmdArgs.push('--version', pdmVersion)

  // Add PyPI mirror configuration if provided
  if (pypiMirror) {
    core.info(`Using PyPI mirror: ${pypiMirror}`)
    core.exportVariable('PDM_PYPI_URL', pypiMirror)
    // Also set pip's index-url for the installation process
    core.exportVariable('PIP_INDEX_URL', pypiMirror)
  }

  cmdArgs.push('-o', 'install-output.json')
  // Use the default python version installed with the runner
  try {
    const installedPython = await utils.findPythonVersion(pythonVersion, arch, allowPythonPreReleases, updateEnvironment)

    if (process.platform === 'linux') {
      // See https://github.com/actions/virtual-environments/issues/2803
      core.exportVariable('LD_PRELOAD', '/lib/x86_64-linux-gnu/libgcc_s.so.1')
    }
    await exec(IS_WINDOWS ? 'python' : 'python3', cmdArgs, { input: await utils.fetchUrlAsBuffer(INSTALL_SCRIPT_URL) })
    const installOutput: InstallOutput = JSON.parse(await utils.readFile('install-output.json'))
    core.debug(`Install output: ${installOutput}`)
    core.info(`Successfully setup ${installOutput.pdm_version} with Python ${installedPython}`)
    core.setOutput('pdm-version', installOutput.pdm_version)
    core.setOutput('pdm-bin', path.join(installOutput.install_location, installOutput.pdm_bin))
    core.addPath(path.dirname(installOutput.pdm_bin))
    if (core.getBooleanInput('enable-pep582'))
      core.exportVariable('PYTHONPATH', getPep582Path(installOutput.install_location, installOutput.install_python_version))

    const matchersPath = path.join(__dirname, '..', '.github')
    core.info(`##[add-matcher]${path.join(matchersPath, 'python.json')}`)
    if (utils.isCacheAvailable())
      await cacheDependencies(installOutput.pdm_bin, installedPython)

    await fs.rm('install-output.json')
  }
  catch (error: any) {
    core.setFailed(error.message)
  }
}

run()
