import { Metadata } from "next"
import { notFound } from "next/navigation"
import { listProducts } from "@lib/data/products"
import { getRegion, listRegions } from "@lib/data/regions"
import ProductTemplate from "@modules/products/templates"

type Props = {
  params: Promise<{ countryCode: string; handle: string }>
}

export async function generateStaticParams() {
  const startTime = Date.now()
  console.log('🚀 Début de génération des static params pour les produits...')
  
  try {
    // Timeout global pour éviter que Vercel coupe le build
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Timeout: Génération des static params trop longue')), 45000) // 45s max
    })

    const generateParamsPromise = async () => {
      // Récupération des régions avec retry
      const regions = await retryOperation(
        () => listRegions(),
        3,
        'listRegions'
      )

      if (!regions || regions.length === 0) {
        console.warn('⚠️ Aucune région trouvée, utilisation des valeurs par défaut')
        return getDefaultParams()
      }

      const countryCodes = regions
        ?.map((r) => r.countries?.map((c) => c.iso_2))
        .flat()
        .filter(Boolean)

      if (!countryCodes || countryCodes.length === 0) {
        console.warn('⚠️ Aucun code pays trouvé, utilisation des valeurs par défaut')
        return getDefaultParams()
      }

      console.log(`📍 ${countryCodes.length} pays trouvés: ${countryCodes.join(', ')}`)

      // Limitation pour éviter trop de requêtes simultanées
      const maxConcurrentRequests = 3
      const countryBatches = []
      
      for (let i = 0; i < countryCodes.length; i += maxConcurrentRequests) {
        countryBatches.push(countryCodes.slice(i, i + maxConcurrentRequests))
      }

      const allCountryProducts = []

      for (const batch of countryBatches) {
        console.log(`🔄 Traitement du batch: ${batch.join(', ')}`)
        
        const batchPromises = batch.map(async (country) => {
          try {
            const result = await retryOperation(
              () => listProducts({
                countryCode: country,
                queryParams: { limit: 50, fields: "handle" }, // Réduit de 100 à 50
              }),
              2, // Moins de retry par pays
              `listProducts-${country}`
            )

            return {
              country,
              products: result?.response?.products || [],
            }
          } catch (error) {
            console.warn(`❌ Échec pour ${country}:`, error.message)
            return {
              country,
              products: [],
            }
          }
        })

        const batchResults = await Promise.all(batchPromises)
        allCountryProducts.push(...batchResults)
        
        // Petite pause entre les batches
        if (countryBatches.indexOf(batch) < countryBatches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }

      const staticParams = allCountryProducts
        .flatMap((countryData) =>
          (countryData.products || []).map((product) => ({
            countryCode: countryData.country,
            handle: product.handle,
          }))
        )
        .filter((param) => param.handle && param.countryCode)

      const duration = Date.now() - startTime
      console.log(`✅ Génération terminée: ${staticParams.length} produits en ${duration}ms`)
      
      return staticParams

    }

    // Race entre la génération et le timeout
    const result = await Promise.race([generateParamsPromise(), timeoutPromise])
    return result

  } catch (error) {
    const duration = Date.now() - startTime
    console.error(
      `❌ Échec génération static paths après ${duration}ms: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    )
    
    // Retourner des paramètres par défaut pour éviter le crash
    return getDefaultParams()
  }
}

// Fonction helper pour les retry avec backoff exponentiel
async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  operationName: string
): Promise<T> {
  let lastError: Error

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`⏳ ${operationName} - tentative ${attempt}/${maxRetries}`)
      const result = await operation()
      console.log(`✅ ${operationName} - succès`)
      return result
    } catch (error) {
      lastError = error as Error
      console.warn(`❌ ${operationName} - tentative ${attempt} échouée:`, error.message)
      
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // Backoff exponentiel, max 5s
        console.log(`⏸️ Attente ${delay}ms avant retry...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError!
}

// Paramètres par défaut en cas d'échec total
function getDefaultParams() {
  console.log('📝 Utilisation des paramètres par défaut')
  const defaultCountries = ['us', 'dk', 'de', 'fr'] // Ajustez selon vos régions
  const defaultHandles = ['sample-product', 'test-product'] // Ajustez selon vos produits
  
  return defaultCountries.flatMap(country =>
    defaultHandles.map(handle => ({
      countryCode: country,
      handle: handle,
    }))
  )
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  try {
    const params = await props.params
    const { handle } = params
    const region = await getRegion(params.countryCode)

    if (!region) {
      notFound()
    }

    const product = await listProducts({
      countryCode: params.countryCode,
      queryParams: { handle },
    }).then(({ response }) => response.products[0])

    if (!product) {
      notFound()
    }

    return {
      title: `${product.title} | Medusa Store`,
      description: `${product.title}`,
      openGraph: {
        title: `${product.title} | Medusa Store`,
        description: `${product.title}`,
        images: product.thumbnail ? [product.thumbnail] : [],
      },
    }
  } catch (error) {
    console.error('Erreur génération metadata:', error)
    return {
      title: 'Produit | Medusa Store',
      description: 'Produit Medusa Store',
    }
  }
}

export default async function ProductPage(props: Props) {
  const params = await props.params
  const region = await getRegion(params.countryCode)

  if (!region) {
    notFound()
  }

  const pricedProduct = await listProducts({
    countryCode: params.countryCode,
    queryParams: { handle: params.handle },
  }).then(({ response }) => response.products[0])

  if (!pricedProduct) {
    notFound()
  }

  return (
    <ProductTemplate
      product={pricedProduct}
      region={region}
      countryCode={params.countryCode}
    />
  )
}

// Configuration Next.js pour optimiser les performances
export const revalidate = 3600 // Revalider toutes les heures
export const dynamicParams = true // Permettre la génération à la demande
export const fetchCache = 'default-cache'