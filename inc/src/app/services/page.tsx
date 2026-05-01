import { createServerSupabase } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Wrench,
  Zap,
  Hammer,
  Paintbrush,
  Sparkles,
  Home,
  Wifi,
  Lock,
  Bug,
  Leaf,
  Truck,
  BookOpen,
  Palette,
  ChefHat,
} from 'lucide-react'

const iconMap: Record<string, React.ReactNode> = {
  plumber: <Wrench className="h-8 w-8" />,
  electrician: <Zap className="h-8 w-8" />,
  carpenter: <Hammer className="h-8 w-8" />,
  painter: <Paintbrush className="h-8 w-8" />,
  cleaner: <Sparkles className="h-8 w-8" />,
  handyman: <Home className="h-8 w-8" />,
  appliance_repair: <Wifi className="h-8 w-8" />,
  hvac: <Wifi className="h-8 w-8" />,
  locksmith: <Lock className="h-8 w-8" />,
  pest_control: <Bug className="h-8 w-8" />,
  gardener: <Leaf className="h-8 w-8" />,
  mover: <Truck className="h-8 w-8" />,
  tutor: <BookOpen className="h-8 w-8" />,
  beautician: <Palette className="h-8 w-8" />,
  caterer: <ChefHat className="h-8 w-8" />,
}

export default async function ServicesPage() {
  const supabase = await createServerSupabase()

  const { data: categories } = await supabase
    .from('service_categories')
    .select('slug, name, description')
    .order('name', { ascending: true })

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 p-4">
      <div className="mx-auto max-w-6xl pt-8 pb-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Services Near You</h1>
          <p className="text-lg text-gray-600 dark:text-gray-300">
            Find trusted local professionals for any job
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {categories?.map((category: any) => (
            <Link key={category.slug} href={`/services/${category.slug}`}>
              <Card className="h-full cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all">
                <CardContent className="p-6">
                  <div className="flex flex-col items-center text-center space-y-4">
                    <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center text-blue-600 dark:text-blue-300">
                      {iconMap[category.slug] || <Wrench className="h-8 w-8" />}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold">{category.name}</h3>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {category.description}
                      </p>
                    </div>
                    <Button variant="outline" className="w-full mt-2">
                      Browse {category.name}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
