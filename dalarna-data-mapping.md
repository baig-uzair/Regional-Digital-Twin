**Data Mapping for a Regional Digital Twin in Dalarna**

*Public Data Sources, API Access and Integration Assessment*

**Thesis:** A Scalable and Interoperable System Architecture Framework
for a Regional Digital Twin in Dalarna

# 1. Data mapping

This document presents a focused data-mapping assessment for the
proposed Regional Digital Twin (DT) in Dalarna. The purpose is to
identify public data sources that can support the technical
architecture, describe what data they provide, identify how the data can
be accessed, and assess how the sources could be integrated into a
common regional data layer.

The mapping is aligned with the thesis aim of designing, modelling and
validating a conceptual technical solution and system architecture for
Dalarna\'s regional Digital Twin. The thesis specifically requires
attention to heterogeneous data integration, interoperability, security
and a scalable \'start small and expand\' deployment approach.

The feasibility study for the Digital Twin identifies data mapping as an
important activity. It calls for an inventory of relevant geodata,
transport, environmental, population/health and infrastructure data,
identification of access gaps, and consideration of data-sharing and
legal issues. This document therefore treats the data source itself, the
technical access mechanism, and the proposed integration method as
connected parts of the mapping.

# 2. Scope and Selection of Data Sources

The five sources were selected to provide different but complementary
data types:

  --------------------------------------------------------------------------------
  **Source**        **Main domain**   **Main data       **Role in proposed DT**
                                      type**            
  ----------------- ----------------- ----------------- --------------------------
  Lantmäteriet      Geospatial        Buildings,        Spatial reference/base
                    foundation        elevation,        layer
                                      property and      
                                      other national    
                                      geodata           

  SCB               Population and    Population,       Regional/social indicators
                    socioeconomics    labour,           
                                      education,        
                                      housing and other 
                                      statistics        

  Skogsstyrelsen    Forestry and      Forest volume,    Forest/resource layer
                    natural resources height, biomass,  
                                      diameter and      
                                      basal area        

  SGU               Geology and       Groundwater       Geological/environmental
                    groundwater       bodies/levels and layer
                                      geological        
                                      information       
  --------------------------------------------------------------------------------

## 2.1 Mapping criteria

-   Authority and authenticity: the source should be operated or
    published by an official Swedish public authority or official public
    information system.

-   Data relevance: the source should provide information that can
    support one or more plausible regional DT use cases.

-   Machine accessibility: preference is given to APIs, OGC services or
    structured downloads that can be consumed by software.

-   Interoperability: the source should expose data in a form that can
    be transformed into common regional schemas.

-   Geographic applicability: national datasets should support filtering
    or spatial selection for Dalarna where possible.

-   Integration feasibility: authentication, rate limits, formats,
    coordinate reference systems and updating characteristics are
    considered.

# 3. Data-Mapping Method

The mapping follows a source-to-integration approach. First, the
official provider and dataset are identified. Second, the technical
access mechanism and documentation are checked. Third, the data
structure, geographic information, format and authentication
requirements are recorded. Finally, the source is mapped to the proposed
Digital Twin ingestion, storage and analytics layers.

The practical verification procedure proposed for the prototype is:

1.  Open the provider\'s official API or data documentation.

2.  Identify the dataset or collection relevant to Dalarna.

3.  Test the endpoint or download using a browser, API client or Python
    requests.

4.  Record HTTP status, response format and metadata.

5.  Check whether the response contains the expected fields and
    geographic information.

6.  Filter or spatially select Dalarna where supported.

7.  Transform the response to a common internal schema.

8.  Load a small sample into PostgreSQL/PostGIS for integration testing.

9.  Record authentication, update frequency, limitations and observed
    errors.

# 4. Data Source Mapping

## 4.1 Lantmäteriet

Lantmäteriet is the Swedish national authority for mapping, cadastral
and land-registration information. For the Digital Twin, its geospatial
information can provide the spatial foundation on which other regional
datasets are positioned.

### Data provided

-   Base/topographic geodata and administrative boundaries.

-   Elevation information and height-related datasets.

-   Building and property-related geospatial information, depending on
    the selected product.

-   Orthophoto and other national geodata products.

-   Geodata services through the National Geodata Platform (NGP).

### Technical access

The National Geodata Platform provides machine-to-machine APIs for
searching, downloading and viewing data. The NGP technical documentation
states that its search API follows STAC and OGC API Features. Access
conditions vary by dataset/service, so the exact selected dataset must
be checked before implementation.

### Proposed integration

Lantmäteriet data should enter the ingestion layer through an NGP
connector. The connector should preserve source identifiers and
metadata, convert the selected geospatial representation into a standard
internal representation, and store the resulting features in PostGIS.

### Verification test

-   Select one Dalarna-relevant dataset in NGP.

-   Read its API description and identify the search/download endpoint.

-   Test the verification environment where applicable before
    production.

-   Confirm the returned feature structure and coordinate reference
    system.

-   Load a small geographic subset into PostGIS and visualize it.

**Official NGP technical description:**
[[https://www2.lantmateriet.se/sv/nationella-geodataplattformen/arkitektur/teknisk-beskrivning-av-ngp/]{.underline}](https://www2.lantmateriet.se/sv/nationella-geodataplattformen/arkitektur/teknisk-beskrivning-av-ngp/)

**Lantmäteriet NGP consumer/technical information:**
[[https://www.lantmateriet.se/sv/nationella-geodataplattformen/konsument/teknik\--konsument/]{.underline}](https://www.lantmateriet.se/sv/nationella-geodataplattformen/konsument/teknik--konsument/)

**Lantmäteriet API portal:**
[[https://www.lantmateriet.se/sv/geodata/vara-produkter/produktsupport/api-portalen/]{.underline}](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktsupport/api-portalen/)

## 4.2 Statistics Sweden (SCB)

SCB provides Sweden\'s official statistics. It is relevant to the
Digital Twin because the proposed architecture includes aggregated
population and socioeconomic indicators. The SCB Statistical Database
contains tables covering areas such as population, labour market,
education, housing, energy and environment.

### Data provided

-   Population by geography, age and sex.

-   Labour-market and employment statistics.

-   Education statistics.

-   Housing and building statistics.

-   Business and regional socioeconomic indicators.

-   Other official statistical tables that can be filtered by available
    geographic dimensions.

### Technical access: PxWebApi v2

SCB launched PxWebApi v2 in October 2025. It provides machine-readable
access to the Statistical Database, uses more stable REST-style URLs,
exposes metadata and supports GET-based retrieval and more advanced
filtering.

### Proposed integration

An SCB connector can retrieve selected tables or filtered values,
validate the metadata, normalize geography and time dimensions, and
store the resulting observations as regional indicators. SCB data should
normally be stored with table identifier, variable identifiers,
reference period and source metadata so that the origin of each
indicator remains traceable.

### Verification test

-   Open the SCB Statistical Database and select a table relevant to
    Dalarna.

-   Inspect the table metadata and identify the geographic variable.

-   Use PxWebApi v2 to retrieve a small subset.

-   Record the HTTP response and machine-readable result.

-   Verify that Dalarna or its relevant municipalities/regions are
    represented in the selected table.

**SCB PxWebApi v2:**
[[https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0]{.underline}](https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0)

**SCB API overview:**
[[https://www.scb.se/api_en?menu=open]{.underline}](https://www.scb.se/api_en?menu=open)

**SCB Statistical Database:**
[[https://www.statistikdatabasen.scb.se/pxweb/en/ssd/]{.underline}](https://www.statistikdatabasen.scb.se/pxweb/en/ssd/)

## 4.3 Skogsstyrelsen

Skogsstyrelsen provides forest-related data. The Skogliga grunddata API
provides calculated information about forest areas and properties,
including volume, basal area, mean height, biomass and mean diameter.
This is relevant to Dalarna because forestry and natural-resource
management are important regional contexts.

### Technical access and authentication

The official Skogsstyrelsen API documentation specifies HTTPS, JSON
responses, GET requests for data retrieval and POST requests when
geometry is supplied as WKT. The API uses OAuth 2.0 Client Credentials.
A registered application receives a ClientId and ClientSecret and
obtains a temporary bearer token. The documented token lifetime is 60
minutes.

This source is therefore useful for testing authenticated
machine-to-machine integration in the proposed architecture.

### Proposed integration

The connector should separate authentication from data retrieval.
Credentials should be kept in environment variables or a
secret-management system. The connector obtains a token, sends the
bearer token with the API request, retrieves JSON, validates the
response and stores the selected forest attributes with their spatial
reference.

### Verification test

-   Register the application according to Skogsstyrelsen\'s API
    procedure.

-   Store ClientId and ClientSecret securely.

-   Request an OAuth 2.0 access token.

-   Use the bearer token to make a documented Skogliga grunddata
    request.

-   Record HTTP 200 and inspect the JSON response.

-   Test a Dalarna coordinate/geometry and confirm the returned forest
    attributes.

**Skogsstyrelsen API overview:**
[[https://www.skogsstyrelsen.se/skogsstyrelsensapi]{.underline}](https://www.skogsstyrelsen.se/skogsstyrelsensapi)

**Skogsstyrelsen API Swagger/OpenAPI:**
[[https://api.skogsstyrelsen.se/sksapi/swagger/index.html?urls.primaryName=skogliga+grunddata_v1.0]{.underline}](https://api.skogsstyrelsen.se/sksapi/swagger/index.html?urls.primaryName=skogliga+grunddata_v1.0)

**Skogsstyrelsen REST geodata services:**
[[https://www.skogsstyrelsen.se/rest]{.underline}](https://www.skogsstyrelsen.se/rest)

## 4.4 Geological Survey of Sweden (SGU)

SGU provides geological and groundwater information. The source is
relevant to environmental planning, groundwater management, construction
and other spatial analyses that may form part of a regional Digital
Twin.

### Data provided

-   Groundwater bodies and related spatial features.

-   Observed groundwater levels through dedicated datasets.

-   Wells and geological information through SGU\'s broader open-data
    catalogue.

-   Geological, soil and mineral-related datasets through separate SGU
    products.

### Technical access

Selected SGU datasets are exposed through OGC API Features. The official
groundwater API exposes a landing page, OpenAPI definition, collections,
queryables and feature retrieval endpoints. Feature responses are
available in GeoJSON-compatible structures.

### Proposed integration

The SGU connector can use the OGC API Features collection and item
endpoints. A bounding-box filter or other supported query can be used to
limit the retrieved data. The returned GeoJSON can be converted to
GeoDataFrame/PostGIS geometry while retaining the source feature
identifier.

### Verification test

-   Open the SGU OGC API landing/OpenAPI page.

-   List the available collections.

-   Select a groundwater collection.

-   Retrieve a small number of features or a Dalarna bounding box.

-   Confirm geometry and properties are present.

-   Load the GeoJSON into PostGIS and inspect the coordinate reference
    system.

**SGU OGC API Features -- groundwater bodies:**
[[https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/openapi?f=text%2Fhtml]{.underline}](https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/openapi?f=text%2Fhtml)

**SGU OGC API Features -- observed groundwater levels:**
[[https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/openapi?f=text%2Fhtml]{.underline}](https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/openapi?f=text%2Fhtml)

**SGU open data:**
[[https://www.sgu.se/produkter-och-tjanster/oppna-data/]{.underline}](https://www.sgu.se/produkter-och-tjanster/oppna-data/)

# 5. Comparative Data-Mapping Table

  ----------------------------------------------------------------------------------------------------------------------------------------------
  **Source**       **Domain**      **Access**      **Authentication**   **Typical format** **Spatial      **Update type**  **DT role**
                                                                                           capability**                    
  ---------------- --------------- --------------- -------------------- ------------------ -------------- ---------------- ---------------------
  Lantmäteriet     Geospatial      NGP             Depends on           OGC/geospatial     High           Periodic         Spatial foundation
                                   APIs/services   dataset/service      formats                                            

  SCB              Statistics      PxWebApi v2     Database/API access  Machine-readable   Geographic     Periodic         Population/social
                                                                        statistics         dimensions                      indicators

  Skogsstyrelsen   Forestry        REST/API        OAuth 2.0 for        JSON; WKT geometry High           Periodic/LiDAR   Forest/resource layer
                                                   Skogliga grunddata                                     cycles           
                                                   API                                                                     

  SGU              Geology/water   OGC API         Open access for      GeoJSON/OGC        High           Dataset          Geology/groundwater
                                   Features        selected datasets                                      dependent        
  ----------------------------------------------------------------------------------------------------------------------------------------------

# 6. Authenticity and Data-Source Validation

For this thesis, authenticity should be demonstrated through provenance
rather than assumed. The recommended validation procedure is to use the
provider\'s official domain and documentation, test the documented
endpoint, record the response, and preserve source metadata.

  -------------------------------------------------------------------------------
  **Validation      **Evidence to record**    **Why it          **Example**
  item**                                      matters**         
  ----------------- ------------------------- ----------------- -----------------
  Publisher         Official organisation and Establishes       SCB / SGU /
                    dataset name              provenance        Skogsstyrelsen

  Official          Documentation URL and     Shows the         Swagger/OpenAPI
  documentation     version/date              endpoint is       
                                              documented        

  HTTPS/API         HTTP status and response  Confirms          HTTP 200
  response          headers                   technical         
                                              reachability      

  Schema            Field names and data      Checks that       JSON properties
                    types                     response matches  
                                              documentation     

  Geography         CRS/geometry/geographic   Confirms Dalarna  Dalarna
                    code                      applicability     municipality /
                                                                bbox

  Metadata          Dataset ID, timestamp,    Supports          Source ID +
                    source, license           traceability      update date
  -------------------------------------------------------------------------------

# 7. Proposed Integration into the Digital Twin Architecture

The five sources should not be connected directly to the final
visualization layer. Instead, each source should have a connector in an
ingestion layer. This supports heterogeneous protocols, authentication
and formats while keeping the rest of the architecture independent of
individual source implementations.

> Public data sources
>
> ↓
>
> Source-specific connectors (NGP / PxWebApi / REST / OGC API Features)
>
> ↓
>
> Authentication + request management + error handling
>
> ↓
>
> Validation and metadata capture
>
> ↓
>
> Transformation / normalization
>
> ↓
>
> Regional data layer (PostgreSQL/PostGIS or data lake)
>
> ↓
>
> Analytics / simulation services
>
> ↓
>
> Digital Twin semantic / visualization interface

## 7.1 Example internal data model

  ---------------------------------------------------------------------------------------------------------------------------
  **Field**          **Purpose**                **Example**          **Source**                  **Required**   **Notes**
  ------------------ -------------------------- -------------------- --------------------------- -------------- -------------
  source_id          Source system identifier   SGU                  All                         Yes            Stable source
                                                                                                                identifier

  dataset_id         Dataset/collection/table   groundwater_bodies   All                         Yes            Original
                                                                                                                dataset ID

  feature_id         Feature/observation ID     SGU feature ID       Geospatial sources          When available Preserve
                                                                                                                source key

  timestamp/period   Observation/reference      2026 / 2026-01       SCB/VISS/etc.               When available Do not
                     period                                                                                     confuse
                                                                                                                update time
                                                                                                                with
                                                                                                                observation
                                                                                                                time

  geometry           Spatial object             POINT/POLYGON        Lantmäteriet/SGU/VISS/SKS   When available Store in
                                                                                                                PostGIS

  attributes         Domain values              volume, biomass,     All                         Yes            Normalize
                                                status                                                          only where
                                                                                                                necessary
  ---------------------------------------------------------------------------------------------------------------------------

# 8. API Testing and Prototype Verification Plan

The data mapping should be followed by a small technical verification.
The purpose is not to build the complete Digital Twin, but to prove that
heterogeneous public data can be discovered, retrieved, validated,
transformed and stored using a common architecture.

  ---------------------------------------------------------------------------------------------------------------------------
  **Source**       **First test**     **Expected   **Dalarna test**         **Integration   **Credential         **Status**
                                      evidence**                            test**          handling**           
  ---------------- ------------------ ------------ ------------------------ --------------- -------------------- ------------
  SCB              Retrieve           JSON + HTTP  Select                   Store           No secret embedded   To be tested
                   metadata/data from response     Dalarna/municipalities   observations in                      
                   one selected table                                       PostgreSQL                           

  SGU              Retrieve OGC       GeoJSON      BBox/filter for Dalarna  Load into       Open endpoint where  To be tested
                   collection/items   features                              PostGIS         applicable           

  Skogsstyrelsen   Obtain OAuth token Bearer       Dalarna                  Store forest    Client secret in     To be tested
                   and query API      token + JSON geometry/coordinate      attributes      environment/secret   
                                                                                            store                

  Lantmäteriet     Test selected NGP  Documented   Dalarna area             Load spatial    Follow selected      To be tested
                   service            geospatial                            subset into     service\'s auth      
                                      response                              PostGIS         rules                
  ---------------------------------------------------------------------------------------------------------------------------

Important: the \'Status\' column is intentionally marked \'To be
tested\'. This document is a mapping and integration plan; it does not
claim that the student has successfully authenticated to every API or
retrieved every dataset. After practical testing, the status should be
changed to Passed, Partially Passed or Failed and supported with test
evidence.

# 9. Data Gaps and Limitations

-   Local energy-grid capacity and load data are not identified as a
    mature open machine-readable source at the required local
    resolution. Such data may require agreements with grid operators.

-   Municipal infrastructure such as local roads, water, sewage and
    other operational systems remains fragmented across municipalities.

-   Fine-grained public-health information is constrained by privacy,
    legal and organisational considerations and is not equivalent to
    open aggregate statistics.

-   National datasets are not automatically Dalarna-specific; the
    integration must apply geographic filtering or use
    regional/municipal identifiers where available.

-   Update frequency differs substantially between sources. A regional
    DT architecture therefore needs metadata describing update time and
    temporal validity.

-   Different coordinate systems and identifiers will require
    normalization before cross-source spatial analysis.

# 10. Implications for the Proposed Architecture

The mapping indicates that a single universal connector is unlikely to
be sufficient. The architecture should support multiple ingestion
patterns: REST/JSON, PxWeb statistical retrieval, OGC API Features, NGP
geospatial services and OAuth/API-key protected APIs.

-   Connector abstraction: each source should have a source-specific
    adapter.

-   Credential isolation: API keys, client secrets and tokens should be
    stored outside application code.

-   Metadata catalogue: source, dataset, version, update time, license
    and geographic reference should be recorded.

-   Spatial normalization: common coordinate reference systems and
    PostGIS geometry should be used where cross-source spatial analysis
    is required.

-   Schema evolution: source schemas can change, so transformation
    should be isolated from downstream analytics.

-   Observability: ingestion logs should capture request time, response
    status, record counts and failures.

-   Scalability: new sources should be addable without redesigning the
    storage, analytics and visualization layers.

# 11. Conclusion

The five selected sources provide complementary building blocks for a
regional Digital Twin in Dalarna. Lantmäteriet provides the spatial
foundation, SCB provides population and socioeconomic statistics,
Skogsstyrelsen provides forest attributes, SGU provides geological and
groundwater information, and VISS provides water-related information.

The main architectural finding from the mapping is that the sources are
heterogeneous in both content and technical access. Therefore, the
Digital Twin should use a dedicated ingestion and integration layer
rather than connecting the visualization layer directly to each source.

The next practical step is API verification: obtain the required
credentials, test one dataset from each source, record the responses and
metadata, transform small samples into a common structure, and load them
into a spatially enabled regional data store. This will provide concrete
evidence for the thesis prototype and support the evaluation of
interoperability and scalability.

# 12. Official References and API Documentation

**Lantmäteriet -- Technical description of NGP:**
[[https://www2.lantmateriet.se/sv/nationella-geodataplattformen/arkitektur/teknisk-beskrivning-av-ngp/]{.underline}](https://www2.lantmateriet.se/sv/nationella-geodataplattformen/arkitektur/teknisk-beskrivning-av-ngp/)

**Lantmäteriet -- NGP consumer technical information:**
[[https://www.lantmateriet.se/sv/nationella-geodataplattformen/konsument/teknik\--konsument/]{.underline}](https://www.lantmateriet.se/sv/nationella-geodataplattformen/konsument/teknik--konsument/)

**Lantmäteriet -- API Portal:**
[[https://www.lantmateriet.se/sv/geodata/vara-produkter/produktsupport/api-portalen/]{.underline}](https://www.lantmateriet.se/sv/geodata/vara-produkter/produktsupport/api-portalen/)

**SCB -- PxWebApi v2:**
[[https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0]{.underline}](https://www.scb.se/en/services/open-data-api/pxwebapi/pxwebapi-2.0)

**SCB -- API overview:**
[[https://www.scb.se/api_en?menu=open]{.underline}](https://www.scb.se/api_en?menu=open)

**SCB -- Statistical Database:**
[[https://www.statistikdatabasen.scb.se/pxweb/en/ssd/]{.underline}](https://www.statistikdatabasen.scb.se/pxweb/en/ssd/)

**Skogsstyrelsen -- API overview:**
[[https://www.skogsstyrelsen.se/skogsstyrelsensapi]{.underline}](https://www.skogsstyrelsen.se/skogsstyrelsensapi)

**Skogsstyrelsen -- API Swagger/OpenAPI:**
[[https://api.skogsstyrelsen.se/sksapi/swagger/index.html?urls.primaryName=skogliga+grunddata_v1.0]{.underline}](https://api.skogsstyrelsen.se/sksapi/swagger/index.html?urls.primaryName=skogliga+grunddata_v1.0)

**Skogsstyrelsen -- REST geodata services:**
[[https://www.skogsstyrelsen.se/rest]{.underline}](https://www.skogsstyrelsen.se/rest)

**SGU -- OGC API Features: groundwater bodies:**
[[https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/openapi?f=text%2Fhtml]{.underline}](https://api.sgu.se/oppnadata/grundvattenforekomster/ogc/features/v1/openapi?f=text%2Fhtml)

**SGU -- OGC API Features: observed groundwater levels:**
[[https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/openapi?f=text%2Fhtml]{.underline}](https://api.sgu.se/oppnadata/grundvattennivaer-observerade/ogc/features/v1/openapi?f=text%2Fhtml)

**SGU -- Open data:**
[[https://www.sgu.se/produkter-och-tjanster/oppna-data/]{.underline}](https://www.sgu.se/produkter-och-tjanster/oppna-data/)
