const express = require('express');
const { wfs, generateAppUrl, logger, makeAsyncHandler, extractParam, generateAppUrlWithoutRelativeRoot } = require('../util');
const cmr = require('../cmr');
const convert = require('../convert');
const { assertValid, schemas } = require('../validator');
const settings = require('../settings');

async function getCollections (request, response) {
  try {
    logger.info(`GET ${request.params.providerId}/collections`);
    const event = request.apiGateway.event;

    const currPage = parseInt(extractParam(event.queryStringParameters, 'page_num', '1'), 10);
    const nextPage = currPage + 1;
    const prevPage = currPage - 1;
    const newParams = { ...event.queryStringParameters } || {};
    newParams.page_num = nextPage;
    const newPrevParams = { ...event.queryStringParameters } || {};
    newPrevParams.page_num = prevPage;
    const prevResultsLink = generateAppUrlWithoutRelativeRoot(event, event.path, newPrevParams);
    const nextResultsLink = generateAppUrlWithoutRelativeRoot(event, event.path, newParams);

    const provider = request.params.providerId;
    const params = Object.assign(
      { provider_short_name: provider },
      cmr.convertParams(cmr.WFS_PARAMS_CONVERSION_MAP, request.query)
    );
    const collections = await cmr.findCollections(params);
    if (!collections.length) throw new Error('Collections not found');
    const collectionsResponse = {
      id: provider,
      stac_version: settings.stac.version,
      description: `All collections provided by ${provider}`,
      license: 'not-provided',
      links: [
        wfs.createLink('self', generateAppUrl(event, `/${provider}/collections`),
          `All collections provided by ${provider}`),
        wfs.createLink('root', generateAppUrl(event, '/'), 'CMR-STAC Root'),
        {
          rel: 'next',
          href: nextResultsLink
        }
      ],
      collections: collections.map(coll => convert.cmrCollToWFSColl(event, coll))
    };

    if (currPage > 1 && collectionsResponse.links.length > 1) {
      collectionsResponse.links.splice(collectionsResponse.links.length - 1, 0, {
        rel: 'prev',
        href: prevResultsLink
      });
    }

    if (collectionsResponse.collections.length < 10) {
      collectionsResponse.links.splice(collectionsResponse.links.length - 1);
    }

    await assertValid(schemas.collections, collectionsResponse);
    response.status(200).json(collectionsResponse);
  } catch (e) {
    response.status(400).json(e.message);
  }
}

async function getCollection (request, response) {
  try {
    logger.info(`GET /${request.params.providerId}/collections/${request.params.collectionId}`);
    const event = request.apiGateway.event;
    const conceptId = request.params.collectionId;
    const collection = await cmr.getCollection(conceptId);
    if (!collection) throw new Error(`Collection [${conceptId}] not found`);
    const collectionResponse = convert.cmrCollToWFSColl(event, collection);
    await assertValid(schemas.collection, collectionResponse);
    response.status(200).json(collectionResponse);
  } catch (e) {
    response.status(400).json(e.message);
  }

}

async function getGranules (request, response) {
  try {
    const conceptId = request.params.collectionId;
    logger.info(`GET /${request.params.providerId}/collections/${conceptId}/items`);
    const event = request.apiGateway.event;
    const params = Object.assign(
      { collection_concept_id: conceptId },
      cmr.convertParams(cmr.WFS_PARAMS_CONVERSION_MAP, request.query)
    );
    const granules = await cmr.findGranules(params);
    if (!granules.length) throw new Error('Items not found');
    const granulesResponse = convert.cmrGranulesToFeatureCollection(event, granules);
    await assertValid(schemas.items, granulesResponse);
    response.status(200).json(granulesResponse);
  } catch (e) {
    response.status(400).json(e.message);
  }
}

async function getGranule (request, response) {
  logger.info(`GET /${request.params.providerId}/collections/${request.params.collectionId}/items/${request.params.itemId}`);
  const event = request.apiGateway.event;
  const collConceptId = request.params.collectionId;
  const conceptId = request.params.itemId;
  const granules = await cmr.findGranules({
    collection_concept_id: collConceptId,
    concept_id: conceptId
  });
  const granuleResponse = convert.cmrGranToFeatureGeoJSON(event, granules[0]);
  await assertValid(schemas.item, granuleResponse);
  response.status(200).json(granuleResponse);
}

const CONFORMANCE_RESPONSE = {
  conformsTo: [
    'http://www.opengis.net/spec/wfs-1/3.0/req/core',
    'http://www.opengis.net/spec/wfs-1/3.0/req/oas30',
    'http://www.opengis.net/spec/wfs-1/3.0/req/html',
    'http://www.opengis.net/spec/wfs-1/3.0/req/geojson'
  ]
};

const routes = express.Router();
routes.get('/:providerId/collections', makeAsyncHandler(getCollections));
routes.get('/:providerId/collections/:collectionId', makeAsyncHandler(getCollection));
routes.get('/:providerId/collections/:collectionId/items', makeAsyncHandler(getGranules));
routes.get('/:providerId/collections/:collectionId/items/:itemId', makeAsyncHandler(getGranule));
routes.get('/conformance', (req, res) => res.status(200).json(CONFORMANCE_RESPONSE));

module.exports = {
  getCollections,
  getCollection,
  getGranules,
  getGranule,
  routes
};
